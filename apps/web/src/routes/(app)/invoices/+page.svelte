<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { getAccessToken } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import { formatDate } from '$lib/format';
  import {
    PageHeader,
    Button,
    FilterBar,
    Select,
    Input,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    Tabs,
    toneFor,
    labelFor,
  } from '$lib/components/ui';

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
  // Carrier tab loads eagerly; customer tab lazy-loads on first switch — hence the different defaults.
  let loadingCarrier = $state(true);

  // Client-side pagination for the carrier invoices table (endpoint returns a plain array).
  const PAGE_SIZE = 25;
  let carrierPage = $state(1);
  const carrierTotalPages = $derived(Math.max(1, Math.ceil(invoices.length / PAGE_SIZE)));
  const pagedInvoices = $derived(invoices.slice((carrierPage - 1) * PAGE_SIZE, carrierPage * PAGE_SIZE));

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
    } finally {
      loadingCarrier = false;
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
    carrierPage = 1;
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
  let loadingCustomer = $state(false);

  // Client-side pagination for the customer statements table.
  let customerPage = $state(1);
  const customerTotalPages = $derived(Math.max(1, Math.ceil(customerStatements.length / PAGE_SIZE)));
  const pagedStatements = $derived(
    customerStatements.slice((customerPage - 1) * PAGE_SIZE, customerPage * PAGE_SIZE),
  );

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
    loadingCustomer = true;
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
    } finally {
      loadingCustomer = false;
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
    customerPage = 1;
    if (customerDataLoaded) {
      void loadCustomerData();
    }
  });
</script>

<PageHeader title="Invoices &amp; statements" />

<Tabs
  tabs={[{ id: 'carrier', label: 'Carrier invoices' }, { id: 'customer', label: 'Customer statements' }]}
  bind:active={activeTab}
>
  {#snippet children()}
    <!-- ══════════════════════════════════════════════════════════════ CARRIER TAB -->
    {#if activeTab === 'carrier'}
      <FilterBar>
        <div class="w-36">
          <Select bind:value={statusFilter}>
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="DISPUTED">Disputed</option>
            <option value="APPROVED">Approved</option>
            <option value="PAID">Paid</option>
          </Select>
        </div>
        <Button variant="secondary" onclick={exportCsv}>Export CSV</Button>
        <select
          bind:value={selectedCarrierId}
          class="rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none w-56"
        >
          <option value="" disabled>Draft for carrier…</option>
          {#each carriers as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
        <Button disabled={!selectedCarrierId} onclick={draft}>Generate draft</Button>
      </FilterBar>

      <p class="mb-4 text-sm text-ink-muted">
        A draft bundles the carrier's completed, not-yet-invoiced loads at their estimated cost
        (the expected amount). Reconcile it against the carrier's actual invoice: within tolerance
        it is approved automatically; over tolerance it goes to dispute.
      </p>

      {#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

      {#if loadingCarrier}
        <Card padded={false}><Skeleton rows={6} /></Card>
      {:else}
      <Table>
        {#snippet head()}
          <th>Invoice #</th><th>Carrier</th><th>Expected</th><th>Invoiced</th>
          <th>Variance (net / gross)</th><th>Status</th><th></th>
        {/snippet}
        {#snippet body()}
          {#each pagedInvoices as invoice (invoice.id)}
            <tr>
              <td>
                <button
                  class="font-semibold text-accent hover:underline bg-transparent border-none p-0 cursor-pointer text-sm"
                  onclick={() => expand(invoice)}
                >{invoice.invoiceNumber}</button>
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
              <td><Badge tone={toneFor(invoice.status)}>{labelFor(invoice.status)}</Badge></td>
              <td class="text-right whitespace-nowrap">
                {#if invoice.status === 'DRAFT'}
                  <Button variant="secondary" onclick={() => approve(invoice)}>Approve as-is</Button>
                {:else if invoice.status === 'APPROVED'}
                  <Button variant="secondary" onclick={() => markPaid(invoice)}>Mark paid</Button>
                {/if}
              </td>
            </tr>
            {#if expanded === invoice.id}
              <tr>
                <td colspan="7" class="bg-base p-0">
                  <div class="p-4 space-y-3">
                    <table class="w-full text-sm">
                      <tbody>
                        {#each invoice.lines as line (line.id)}
                          <tr class="border-b border-edge last:border-0">
                            <td class="py-1.5 pr-4">{line.description}</td>
                            <td class="py-1.5 text-right pr-4 text-ink-muted">
                              {Number(line.amount).toLocaleString()} {invoice.currency}
                            </td>
                            <td class="py-1.5 text-right w-40">
                              {#if invoice.status === 'DRAFT' || invoice.status === 'DISPUTED'}
                                <input
                                  type="number"
                                  step="0.01"
                                  bind:value={invoicedAmounts[line.id]}
                                  class="w-28 rounded border border-edge bg-surface px-2 py-0.5 text-right text-sm text-ink focus:border-accent focus:outline-none"
                                />
                              {:else if line.invoicedAmount !== null}
                                {Number(line.invoicedAmount).toLocaleString()}
                                {#if line.variance !== null && Number(line.variance) !== 0}
                                  <span class="text-danger text-xs ml-1">
                                    ({Number(line.variance) > 0 ? '+' : ''}{line.variance})
                                  </span>
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
                      <div class="flex gap-2 items-center flex-wrap">
                        <Input
                          placeholder="Carrier invoice #"
                          bind:value={carrierInvoiceNumber}
                        />
                        <Button
                          variant="primary"
                          disabled={!carrierInvoiceNumber}
                          onclick={() => reconcile(invoice)}
                        >
                          {invoice.status === 'DISPUTED' ? 'Re-reconcile (corrected invoice)' : 'Reconcile'}
                        </Button>
                      </div>
                    {/if}

                    {#if invoice.status === 'DISPUTED'}
                      <div class="flex gap-2 items-center flex-wrap">
                        <div class="w-44">
                          <Select bind:value={resolution}>
                            <option value="ACCEPT_INVOICED">Pay invoiced amount</option>
                            <option value="KEEP_EXPECTED">Pay expected amount</option>
                          </Select>
                        </div>
                        <div class="w-48">
                          <Select bind:value={reasonCode}>
                            {#each REASON_CODES as code (code)}<option value={code}>{code}</option>{/each}
                          </Select>
                        </div>
                        <div class="flex-1 min-w-40">
                          <Input placeholder="Note (optional)" bind:value={disputeNote} />
                        </div>
                        <Button variant="danger" onclick={() => resolve(invoice)}>Resolve dispute</Button>
                      </div>
                    {/if}

                    {#if invoice.disputeReasonCode}
                      <p class="text-sm text-ink-muted">
                        Dispute: {invoice.disputeReasonCode}{invoice.disputeNote ? ` — ${invoice.disputeNote}` : ''}
                      </p>
                    {/if}
                  </div>
                </td>
              </tr>
            {/if}
          {:else}
            <tr><td colspan="7"><EmptyState message="No invoices yet." /></td></tr>
          {/each}
        {/snippet}
      </Table>

      {#if invoices.length > PAGE_SIZE}
        <div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
          <span class="font-mono text-xs">{(carrierPage - 1) * PAGE_SIZE + 1}–{Math.min(carrierPage * PAGE_SIZE, invoices.length)} sur {invoices.length}</span>
          <div class="flex items-center gap-2">
            <Button variant="secondary" disabled={carrierPage <= 1} onclick={() => { carrierPage = Math.max(1, carrierPage - 1); }}>Précédent</Button>
            <span class="font-mono text-xs">Page {carrierPage} / {carrierTotalPages}</span>
            <Button variant="secondary" disabled={carrierPage >= carrierTotalPages} onclick={() => { carrierPage = Math.min(carrierTotalPages, carrierPage + 1); }}>Suivant</Button>
          </div>
        </div>
      {/if}
      {/if}

    <!-- ══════════════════════════════════════════════════════════ CUSTOMER TAB -->
    {:else}
      <!-- Billable preview panel -->
      <Card>
        <h2 class="text-sm font-bold text-ink mb-3">Generate billing statements</h2>
        <div class="flex gap-2 items-center flex-wrap">
          <select
            bind:value={selectedCustomerId}
            class="rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none w-64"
          >
            <option value="" disabled>Select a customer…</option>
            {#each customerOptions as c (c.id)}<option value={c.id}>{c.code} — {c.name}</option>{/each}
          </select>
          <Button
            variant="secondary"
            disabled={!selectedCustomerId || previewLoading}
            onclick={previewBillable}
          >
            {previewLoading ? 'Loading…' : 'Preview billable'}
          </Button>
          {#if previewDone && previewRatable.length > 0}
            <Button onclick={generateStatements}>
              Generate statements ({previewRatable.length} order{previewRatable.length !== 1 ? 's' : ''})
            </Button>
          {/if}
        </div>

        {#if previewDone}
          <div class="mt-4 flex gap-4 flex-wrap items-start">
            {#if previewRatable.length > 0}
              <div class="flex-1 min-w-60">
                <p class="text-xs text-ink-muted mb-2">Ratable ({previewRatable.length})</p>
                <Table>
                  {#snippet head()}<th>Order #</th><th class="text-right">Amount</th>{/snippet}
                  {#snippet body()}
                    {#each previewRatable as row (row.orderId)}
                      <tr>
                        <td>{row.orderNumber}</td>
                        <td class="text-right">{Number(row.amount).toLocaleString()} {row.currency}</td>
                      </tr>
                    {/each}
                  {/snippet}
                </Table>
              </div>
            {:else}
              <p class="text-sm text-ink-muted mt-4">No ratable orders found for this customer.</p>
            {/if}

            {#if previewUnratable.length > 0}
              <div class="flex-1 min-w-60">
                <p class="text-xs text-ink-muted mb-2">Not ratable ({previewUnratable.length})</p>
                <Table>
                  {#snippet head()}<th>Order #</th><th>Reason</th>{/snippet}
                  {#snippet body()}
                    {#each previewUnratable as row (row.orderId)}
                      <tr>
                        <td>{row.orderNumber}</td>
                        <td><Badge tone="warn">{row.reason}</Badge></td>
                      </tr>
                    {/each}
                  {/snippet}
                </Table>
              </div>
            {/if}
          </div>
        {/if}
      </Card>

      <!-- Statements list -->
      <FilterBar>
        <span class="text-sm text-ink-muted">Customer billing statements</span>
        <div class="ml-auto w-36">
          <Select bind:value={statementsStatusFilter}>
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="APPROVED">Approved</option>
            <option value="SENT">Sent</option>
            <option value="PAID">Paid</option>
          </Select>
        </div>
      </FilterBar>

      {#if stmtError}<p class="mb-3 text-sm text-danger">{stmtError}</p>{/if}

      {#if loadingCustomer}
        <Card padded={false}><Skeleton rows={6} /></Card>
      {:else}
      <Table>
        {#snippet head()}
          <th>Statement #</th><th>Customer</th><th>Status</th><th>Currency</th>
          <th class="text-right">Total</th><th>Created</th><th></th>
        {/snippet}
        {#snippet body()}
          {#each pagedStatements as stmt (stmt.id)}
            <tr>
              <td>
                <button
                  class="font-semibold text-accent hover:underline bg-transparent border-none p-0 cursor-pointer text-sm"
                  onclick={() => expandStmt(stmt)}
                >{stmt.invoiceNumber}</button>
              </td>
              <td>{stmt.customer.name}</td>
              <td><Badge tone={toneFor(stmt.status)}>{labelFor(stmt.status)}</Badge></td>
              <td>{stmt.currency}</td>
              <td class="text-right">{Number(stmt.totalAmount).toLocaleString()} {stmt.currency}</td>
              <td>{formatDate(stmt.createdAt)}</td>
              <td class="text-right whitespace-nowrap">
                {#if stmt.status === 'DRAFT'}
                  <Button variant="primary" onclick={() => approveStatement(stmt)}>Approve</Button>
                  <Button variant="danger" onclick={() => deleteStatement(stmt)}>Delete draft</Button>
                {:else if stmt.status === 'APPROVED'}
                  <Button variant="primary" onclick={() => sendStatement(stmt)}>Send</Button>
                {:else if stmt.status === 'SENT'}
                  <Button variant="secondary" onclick={() => payStatement(stmt)}>Mark paid</Button>
                {/if}
              </td>
            </tr>

            {#if stmtExpanded === stmt.id}
              <tr>
                <td colspan="7" class="bg-base p-0">
                  <div class="p-4 space-y-3">
                    <p class="text-xs text-ink-muted">
                      Lines — {stmt.lines.length} order{stmt.lines.length !== 1 ? 's' : ''}
                      {#if stmt.customer.email}
                        · customer email: {stmt.customer.email}
                      {/if}
                    </p>
                    <Table>
                      {#snippet head()}
                        <th>Order #</th><th>Description</th><th class="text-right">Amount</th><th></th>
                      {/snippet}
                      {#snippet body()}
                        {#each stmt.lines as line (line.id)}
                          <tr>
                            <td>{line.transportOrder?.orderNumber ?? '—'}</td>
                            <td>{line.description}</td>
                            <td class="text-right">{Number(line.amount).toLocaleString()} {stmt.currency}</td>
                            <td class="text-right">
                              {#if line.priceDetail}
                                <button
                                  class="text-xs text-accent hover:underline bg-transparent border-none p-0 cursor-pointer"
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
                              <td colspan="4" class="p-3">
                                <div class="rounded-md border border-edge bg-surface p-3 space-y-2">
                                  <div class="flex items-center gap-2 flex-wrap">
                                    <span class="text-xs text-ink-muted">
                                      Price snapshot — ref. {formatDate(pd.referenceDate)}
                                    </span>
                                    <span class="text-xs text-ink-muted">
                                      {pd.rate.name} · {pd.rate.rateType}
                                    </span>
                                  </div>
                                  <table class="w-full text-xs">
                                    <tbody>
                                      {#each pd.result.lines as pline}
                                        <tr>
                                          <td class="py-0.5">{pline.label}</td>
                                          <td class="py-0.5 text-right">{pline.amount.toLocaleString()} {stmt.currency}</td>
                                        </tr>
                                      {/each}
                                      <tr class="border-t border-edge font-semibold">
                                        <td class="py-0.5">Total</td>
                                        <td class="py-0.5 text-right">{pd.result.total.toLocaleString()} {stmt.currency}</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                  {#if pd.result.appliedBreak}
                                    {@const br = pd.result.appliedBreak}
                                    <p class="text-xs text-ink-muted">
                                      Break applied: ≤ {br.upToKg} kg @ {br.amount} $/CWT
                                      {#if br.asIfApplied}
                                        <Badge tone="warn">as-if</Badge>
                                      {/if}
                                    </p>
                                  {/if}
                                  <p class="text-xs text-ink-muted">
                                    Fuel: {pd.rate.fuel.pct}% — {pd.rate.fuel.source}
                                    {#if pd.rate.fuel.source === 'TABLE' && pd.rate.fuel.effectiveFrom}
                                      (eff. {formatDate(pd.rate.fuel.effectiveFrom)})
                                    {/if}
                                  </p>
                                  {#if pd.result.missingAccessorials.length > 0}
                                    <p class="text-xs text-danger">
                                      Missing accessorials: {pd.result.missingAccessorials.join(', ')}
                                    </p>
                                  {/if}
                                </div>
                              </td>
                            </tr>
                          {/if}
                        {/each}
                      {/snippet}
                    </Table>
                  </div>
                </td>
              </tr>
            {/if}
          {:else}
            <tr><td colspan="7"><EmptyState message="No customer statements yet." /></td></tr>
          {/each}
        {/snippet}
      </Table>

      {#if customerStatements.length > PAGE_SIZE}
        <div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
          <span class="font-mono text-xs">{(customerPage - 1) * PAGE_SIZE + 1}–{Math.min(customerPage * PAGE_SIZE, customerStatements.length)} sur {customerStatements.length}</span>
          <div class="flex items-center gap-2">
            <Button variant="secondary" disabled={customerPage <= 1} onclick={() => { customerPage = Math.max(1, customerPage - 1); }}>Précédent</Button>
            <span class="font-mono text-xs">Page {customerPage} / {customerTotalPages}</span>
            <Button variant="secondary" disabled={customerPage >= customerTotalPages} onclick={() => { customerPage = Math.min(customerTotalPages, customerPage + 1); }}>Suivant</Button>
          </div>
        </div>
      {/if}
      {/if}
    {/if}
  {/snippet}
</Tabs>
