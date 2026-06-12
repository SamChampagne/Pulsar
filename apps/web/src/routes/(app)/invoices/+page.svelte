<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { getAccessToken } from '$lib/stores/auth';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import { toast } from '$lib/stores/toast';

  // ── Shared tab state ────────────────────────────────────────────────────────
  let activeTab = $state<'carrier' | 'customer'>('carrier');

  // ── Carrier-invoice types ────────────────────────────────────────────────────
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

  // ── Customer-statement types ─────────────────────────────────────────────────
  interface PriceDetailLine {
    type: string;
    label: string;
    amount: number;
  }
  interface PriceDetail {
    version: number;
    referenceDate: string;
    rate: {
      name: string;
      rateType: string;
      fuel: { pct: number; source: 'TABLE' | 'STATIC' | 'NONE'; effectiveFrom?: string };
    };
    inputs: Record<string, unknown>;
    result: {
      lines: PriceDetailLine[];
      total: number;
      appliedBreak: { upToKg: number; amount: number; asIfApplied: boolean } | null;
      missingAccessorials: string[];
    };
  }
  interface StatementLine {
    id: string;
    description: string;
    amount: string;
    priceDetail: PriceDetail | null;
    transportOrder: { id: string; orderNumber: string; customerReference: string | null } | null;
  }
  interface StatementRow {
    id: string;
    invoiceNumber: string;
    status: 'DRAFT' | 'APPROVED' | 'SENT' | 'PAID';
    currency: string;
    totalAmount: string;
    approvedAt: string | null;
    sentAt: string | null;
    paidAt: string | null;
    createdAt: string;
    customer: { id: string; code: string; name: string; email: string | null };
    lines: StatementLine[];
  }
  interface BillableOrder {
    orderId: string;
    orderNumber: string;
    amount: number;
    currency: string;
  }
  interface UnratableOrder {
    orderId: string;
    orderNumber: string;
    reason: string;
  }
  interface CustomerOption {
    id: string;
    code: string;
    name: string;
  }

  // Customer statements state
  let customerStatements = $state<StatementRow[]>([]);
  let customerOptions = $state<CustomerOption[]>([]);
  let selectedCustomerId = $state('');
  let statementsStatusFilter = $state('');
  let stmtError = $state('');

  // Billable preview state
  let previewLoading = $state(false);
  let previewRatable = $state<BillableOrder[]>([]);
  let previewUnratable = $state<UnratableOrder[]>([]);
  let previewDone = $state(false);

  // Expanded statement row
  let stmtExpanded = $state('');
  // Expanded price detail per line (keyed by line.id)
  let priceDetailExpanded = $state<Record<string, boolean>>({});

  async function loadCustomerData() {
    try {
      const [stmts, customers] = await Promise.all([
        api<StatementRow[]>('/billing/customer-invoices', {
          query: {
            status: statementsStatusFilter || undefined,
          },
        }),
        api<Paginated<CustomerOption>>('/transportation/customers', {
          query: { pageSize: 100 },
        }),
      ]);
      customerStatements = stmts;
      customerOptions = customers.items;
    } catch (e) {
      stmtError = e instanceof ApiError ? e.message : 'Failed to load customer statements';
    }
  }

  async function previewBillable() {
    if (!selectedCustomerId) return;
    previewLoading = true;
    previewDone = false;
    previewRatable = [];
    previewUnratable = [];
    try {
      const result = await api<{ ratable: BillableOrder[]; unratable: UnratableOrder[] }>(
        '/billing/customer-invoices/billable',
        { query: { customerId: selectedCustomerId } },
      );
      previewRatable = result.ratable;
      previewUnratable = result.unratable;
      previewDone = true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to preview billable orders');
    } finally {
      previewLoading = false;
    }
  }

  async function generateStatements() {
    if (!selectedCustomerId || previewRatable.length === 0) return;
    try {
      const result = await api<{ invoices: StatementRow[]; unratable: UnratableOrder[] }>(
        '/billing/customer-invoices',
        { method: 'POST', body: { customerId: selectedCustomerId } },
      );
      const currencies = [...new Set(result.invoices.map((i) => i.currency))].join(', ');
      toast.success(
        `${result.invoices.length} statement(s) created (${currencies})`,
      );
      // Clear preview
      previewRatable = [];
      previewUnratable = [];
      previewDone = false;
      selectedCustomerId = '';
      await loadCustomerData();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to generate statements');
    }
  }

  function expandStmt(stmt: StatementRow) {
    stmtExpanded = stmtExpanded === stmt.id ? '' : stmt.id;
    priceDetailExpanded = {};
  }

  function togglePriceDetail(lineId: string) {
    priceDetailExpanded = {
      ...priceDetailExpanded,
      [lineId]: !priceDetailExpanded[lineId],
    };
  }

  async function approveStatement(stmt: StatementRow) {
    try {
      await api(`/billing/customer-invoices/${stmt.id}/approve`, { method: 'POST' });
      toast.success(`${stmt.invoiceNumber} approved`);
      await loadCustomerData();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to approve statement');
    }
  }

  async function sendStatement(stmt: StatementRow) {
    if (!confirm(`Send statement ${stmt.invoiceNumber} by email to the customer contact?`)) return;
    try {
      await api(`/billing/customer-invoices/${stmt.id}/send`, { method: 'POST' });
      toast.success(`${stmt.invoiceNumber} sent`);
      await loadCustomerData();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to send statement');
    }
  }

  async function payStatement(stmt: StatementRow) {
    try {
      await api(`/billing/customer-invoices/${stmt.id}/pay`, { method: 'POST' });
      toast.success(`${stmt.invoiceNumber} marked paid`);
      await loadCustomerData();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to mark paid');
    }
  }

  async function deleteStatement(stmt: StatementRow) {
    if (
      !confirm(
        `Delete draft statement ${stmt.invoiceNumber}? This frees the orders for regeneration.`,
      )
    )
      return;
    try {
      await api(`/billing/customer-invoices/${stmt.id}`, { method: 'DELETE' });
      toast.success(`${stmt.invoiceNumber} deleted`);
      await loadCustomerData();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete statement');
    }
  }

  // Load customer tab data when switching to it (once)
  let customerDataLoaded = $state(false);
  $effect(() => {
    if (activeTab === 'customer' && !customerDataLoaded) {
      customerDataLoaded = true;
      void loadCustomerData();
    }
  });

  // Reload customer statements when status filter changes (only if tab was loaded)
  $effect(() => {
    void statementsStatusFilter;
    if (customerDataLoaded) {
      void loadCustomerData();
    }
  });
</script>

<div class="page-header">
  <h1>Invoices &amp; statements</h1>
</div>

<!-- Tab navigation -->
<div class="tab-nav">
  <button class="tab-btn" class:active={activeTab === 'carrier'} onclick={() => (activeTab = 'carrier')}>
    Carrier invoices
  </button>
  <button class="tab-btn" class:active={activeTab === 'customer'} onclick={() => (activeTab = 'customer')}>
    Customer statements
  </button>
</div>

<!-- ══════════════════════════════════════════════════════════════ CARRIER TAB -->
{#if activeTab === 'carrier'}
  <div class="tab-toolbar">
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

<!-- ══════════════════════════════════════════════════════════ CUSTOMER TAB -->
{:else}
  <!-- Billable preview panel -->
  <div class="card" style="margin-bottom: 16px;">
    <h2 style="margin-top: 0;">Generate billing statements</h2>
    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
      <select bind:value={selectedCustomerId} style="width: 260px;">
        <option value="" disabled>Select a customer…</option>
        {#each customerOptions as c (c.id)}<option value={c.id}>{c.code} — {c.name}</option>{/each}
      </select>
      <button
        class="btn btn-secondary btn-sm"
        disabled={!selectedCustomerId || previewLoading}
        onclick={previewBillable}
      >
        {previewLoading ? 'Loading…' : 'Preview billable'}
      </button>
      {#if previewDone && previewRatable.length > 0}
        <button class="btn btn-sm" onclick={generateStatements}>
          Generate statements ({previewRatable.length} order{previewRatable.length !== 1 ? 's' : ''})
        </button>
      {/if}
    </div>

    {#if previewDone}
      <div style="margin-top: 14px; display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start;">
        {#if previewRatable.length > 0}
          <div style="flex: 1; min-width: 240px;">
            <p class="muted" style="font-size: 12px; margin: 0 0 6px;">
              Ratable ({previewRatable.length})
            </p>
            <table>
              <thead>
                <tr>
                  <th>Order #</th>
                  <th style="text-align: right;">Amount</th>
                </tr>
              </thead>
              <tbody>
                {#each previewRatable as row (row.orderId)}
                  <tr>
                    <td>{row.orderNumber}</td>
                    <td style="text-align: right;">
                      {Number(row.amount).toLocaleString()} {row.currency}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <p class="muted" style="margin-top: 14px;">No ratable orders found for this customer.</p>
        {/if}

        {#if previewUnratable.length > 0}
          <div style="flex: 1; min-width: 240px;">
            <p class="muted" style="font-size: 12px; margin: 0 0 6px;">
              Not ratable ({previewUnratable.length})
            </p>
            <table>
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {#each previewUnratable as row (row.orderId)}
                  <tr>
                    <td>{row.orderNumber}</td>
                    <td>
                      <span class="badge badge-warning" style="font-size: 11px;">{row.reason}</span>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Statements list -->
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
    <span class="muted" style="font-size: 13px;">Customer billing statements</span>
    <select bind:value={statementsStatusFilter} style="width: 140px;">
      <option value="">All statuses</option>
      <option value="DRAFT">Draft</option>
      <option value="APPROVED">Approved</option>
      <option value="SENT">Sent</option>
      <option value="PAID">Paid</option>
    </select>
  </div>

  {#if stmtError}
    <p class="error-text">{stmtError}</p>
  {/if}

  <div class="card" style="padding: 0;">
    <table>
      <thead>
        <tr>
          <th>Statement #</th>
          <th>Customer</th>
          <th>Status</th>
          <th>Currency</th>
          <th style="text-align: right;">Total</th>
          <th>Created</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each customerStatements as stmt (stmt.id)}
          <tr>
            <td>
              <button class="linklike" onclick={() => expandStmt(stmt)}>
                <strong>{stmt.invoiceNumber}</strong>
              </button>
            </td>
            <td>{stmt.customer.name}</td>
            <td><StatusBadge status={stmt.status} /></td>
            <td>{stmt.currency}</td>
            <td style="text-align: right;">
              {Number(stmt.totalAmount).toLocaleString()} {stmt.currency}
            </td>
            <td>{new Date(stmt.createdAt).toLocaleDateString()}</td>
            <td style="text-align: right; white-space: nowrap;">
              {#if stmt.status === 'DRAFT'}
                <button class="btn btn-sm" style="margin-right: 4px;" onclick={() => approveStatement(stmt)}>
                  Approve
                </button>
                <button class="btn btn-sm btn-danger" onclick={() => deleteStatement(stmt)}>
                  Delete draft
                </button>
              {:else if stmt.status === 'APPROVED'}
                <button class="btn btn-sm" onclick={() => sendStatement(stmt)}>Send</button>
              {:else if stmt.status === 'SENT'}
                <button class="btn btn-sm" onclick={() => payStatement(stmt)}>Mark paid</button>
              {/if}
            </td>
          </tr>

          {#if stmtExpanded === stmt.id}
            <tr>
              <td colspan="7" style="background: var(--color-bg); padding: 12px 16px;">
                <p class="muted" style="font-size: 12px; margin: 0 0 8px;">
                  Lines — {stmt.lines.length} order{stmt.lines.length !== 1 ? 's' : ''}
                  {#if stmt.customer.email}
                    · customer email: {stmt.customer.email}
                  {/if}
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Order #</th>
                      <th>Description</th>
                      <th style="text-align: right;">Amount</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each stmt.lines as line (line.id)}
                      <tr>
                        <td>{line.transportOrder?.orderNumber ?? '—'}</td>
                        <td>{line.description}</td>
                        <td style="text-align: right;">
                          {Number(line.amount).toLocaleString()} {stmt.currency}
                        </td>
                        <td style="text-align: right;">
                          {#if line.priceDetail}
                            <button
                              class="linklike"
                              style="font-size: 11px;"
                              onclick={() => togglePriceDetail(line.id)}
                            >
                              {priceDetailExpanded[line.id] ? '▲ hide detail' : '▼ price detail'}
                            </button>
                          {/if}
                        </td>
                      </tr>
                      {#if line.priceDetail && priceDetailExpanded[line.id]}
                        {@const pd = line.priceDetail}
                        <tr>
                          <td colspan="4" style="padding: 0 12px 12px;">
                            <div class="cost-snapshot">
                              <div class="cost-snapshot-header">
                                <span class="muted" style="font-size: 12px;">
                                  Price snapshot — ref. {new Date(pd.referenceDate).toLocaleDateString()}
                                </span>
                                <span class="muted" style="font-size: 12px;">
                                  {pd.rate.name} · {pd.rate.rateType}
                                </span>
                              </div>
                              <table class="breakdown-table">
                                <tbody>
                                  {#each pd.result.lines as pline}
                                    <tr>
                                      <td style="font-size: 13px;">{pline.label}</td>
                                      <td style="text-align: right; font-size: 13px;">
                                        {pline.amount.toLocaleString()} {stmt.currency}
                                      </td>
                                    </tr>
                                  {/each}
                                  <tr>
                                    <td><strong>Total</strong></td>
                                    <td style="text-align: right;">
                                      <strong>{pd.result.total.toLocaleString()} {stmt.currency}</strong>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                              {#if pd.result.appliedBreak}
                                {@const br = pd.result.appliedBreak}
                                <p style="font-size: 12px; margin: 4px 0;">
                                  <span class="muted">Break applied:</span>
                                  ≤ {br.upToKg} kg @ {br.amount} $/CWT
                                  {#if br.asIfApplied}
                                    <span class="badge badge-warn">as-if</span>
                                  {/if}
                                </p>
                              {/if}
                              <p style="font-size: 12px; margin: 4px 0;">
                                <span class="muted">Fuel:</span>
                                {pd.rate.fuel.pct}% — {pd.rate.fuel.source}
                                {#if pd.rate.fuel.source === 'TABLE' && pd.rate.fuel.effectiveFrom}
                                  <span class="muted">(eff. {new Date(pd.rate.fuel.effectiveFrom).toLocaleDateString()})</span>
                                {/if}
                              </p>
                              {#if pd.result.missingAccessorials.length > 0}
                                <p class="error-text" style="font-size: 12px; margin: 4px 0;">
                                  Missing accessorials: {pd.result.missingAccessorials.join(', ')}
                                </p>
                              {/if}
                            </div>
                          </td>
                        </tr>
                      {/if}
                    {/each}
                  </tbody>
                </table>
              </td>
            </tr>
          {/if}
        {:else}
          <tr><td colspan="7" class="muted">No customer statements yet.</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  /* Carrier tab */
  .linklike {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--color-primary);
    font-size: 13px;
  }

  /* Tab navigation */
  .tab-nav {
    display: flex;
    gap: 0;
    border-bottom: 2px solid var(--color-border);
    margin-bottom: 20px;
  }

  .tab-btn {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    padding: 8px 18px;
    font-size: 13px;
    font-weight: 550;
    color: var(--color-text-muted);
    cursor: pointer;
    transition: color 100ms, border-color 100ms;
  }

  .tab-btn:hover {
    color: var(--color-text);
  }

  .tab-btn.active {
    color: var(--color-primary);
    border-bottom-color: var(--color-primary);
  }

  .tab-toolbar {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }

  /* Price detail snapshot (mirrors loads/[id] .cost-snapshot) */
  .cost-snapshot {
    margin-top: 6px;
    padding: 10px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 6px;
  }

  .cost-snapshot-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }

  .breakdown-table {
    width: 100%;
    font-size: 12px;
    border-collapse: collapse;
  }

  .breakdown-table td {
    padding: 2px 4px;
  }

  .badge-warn {
    background: #fff3cd;
    color: #856404;
    border: 1px solid #ffc107;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11px;
  }
</style>
