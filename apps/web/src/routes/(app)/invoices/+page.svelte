<script lang="ts">
  import { onDestroy } from 'svelte';
  import { auth } from '$lib/stores/auth';
  import { PERMISSIONS } from '@pulsar/shared';
  import { confirmAction } from '$lib/stores/confirmation';
  import { page as route } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import { getAccessToken } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import { formatDate } from '$lib/format';
  import {
    PageHeader,
    Drawer,
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
    ErrorNotice,
    EntityPicker,
    toneFor,
    labelFor,
  } from '$lib/components/ui';

  // ── Shared tab state ────────────────────────────────────────────────────────
  let activeTab = $state<'carrier' | 'customer'>(
    route.url.searchParams.has('statement') ? 'customer' : 'carrier',
  );

  // ── Shared billing types ─────────────────────────────────────────────────────
  interface TaxDetailLine {
    description: string;
    rate: number;
    accountCode: string;
    amount: number;
  }
  interface TaxDetail {
    taxAmount: number;
    lines: TaxDetailLine[];
  }
  interface TaxTemplateOption {
    id: string;
    name: string;
  }

  // ── Carrier-invoice types ────────────────────────────────────────────────────
  interface LineRow {
    id: string;
    description: string;
    amount: string;
    invoicedAmount: string | null;
    variance: string | null;
    load?: { id: string; loadNumber: string } | null;
  }
  interface InvoiceRow {
    incomingAudit?: { id: string } | null;
    id: string;
    invoiceNumber: string;
    status: string;
    currency: string;
    totalAmount: string;
    taxAmount: string;
    taxDetail: TaxDetail | null;
    taxTemplateId: string | null;
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
  const REASON_CODES = [
    'RATE_MISMATCH',
    'QUANTITY_MISMATCH',
    'UNEXPECTED_CHARGE',
    'DUPLICATE_BILLING',
    'OTHER',
  ];

  let invoices = $state<InvoiceRow[]>([]);
  let selectedCarrierId = $state('');
  let statusFilter = $state('');
  let expanded = $state('');
  let invoiceOpen = $state(false);
  let statementOpen = $state(false);
  let invoiceBusy = $state(false);
  let mutationError = $state('');
  let invoiceDraft = '';
  let carrierRequest = 0;
  let customerRequest = 0;
  let lastInvoiceTarget = '';
  let lastStatementTarget = '';
  const selectedInvoice = $derived(invoices.find((invoice) => invoice.id === expanded));
  const canPay = $derived(!!$auth?.user.permissions.includes(PERMISSIONS.BILLING.PAYMENTS_MANAGE));
  const canManageInvoices = $derived(
    !!$auth?.user.permissions.includes(PERMISSIONS.BILLING.INVOICES_MANAGE),
  );
  const canManageStatements = $derived(
    !!$auth?.user.permissions.includes(PERMISSIONS.BILLING.CUSTOMER_INVOICES_MANAGE),
  );
  const snapshotInvoice = () =>
    JSON.stringify([carrierInvoiceNumber, invoicedAmounts, resolution, reasonCode, disputeNote]);
  function beforeInvoiceClose() {
    if (snapshotInvoice() === invoiceDraft) return true;
    void confirmAction('Les montants ou le rapprochement ont été modifiés sans être enregistrés.', {
      title: 'Fermer sans enregistrer ?',
      confirmLabel: 'Abandonner',
    }).then((accepted) => {
      if (accepted) invoiceOpen = false;
    });
    return false;
  }
  async function perform(action: () => Promise<void>) {
    if (invoiceBusy) return;
    invoiceBusy = true;
    mutationError = '';
    try {
      await action();
    } finally {
      invoiceBusy = false;
    }
  }
  const paymentLink = (partyType: string, party: string, target: string) =>
    `/billing/payments/new?partyType=${partyType}&party=${encodeURIComponent(party)}&target=${encodeURIComponent(target)}`;
  onDestroy(() => {
    carrierRequest++;
    customerRequest++;
  });

  let error = $state('');
  // Carrier tab loads eagerly; customer tab lazy-loads on first switch — hence the different defaults.
  let loadingCarrier = $state(true);

  // Billing settings drive optional UI affordances (delete-draft gating).
  let allowInvoiceDeletion = $state(false);
  // Optional payment date when marking a carrier invoice paid (per expanded row).
  let markPaidDate = $state<Record<string, string>>({});

  // Client-side pagination for the carrier invoices table (endpoint returns a plain array).
  const PAGE_SIZE = 25;
  let carrierPage = $state(1);
  const carrierTotalPages = $derived(Math.max(1, Math.ceil(invoices.length / PAGE_SIZE)));
  const pagedInvoices = $derived(
    invoices.slice((carrierPage - 1) * PAGE_SIZE, carrierPage * PAGE_SIZE),
  );
  const disputedCarrierCount = $derived(
    invoices.filter((invoice) => invoice.status === 'DISPUTED').length,
  );
  const approvedCarrierCount = $derived(
    invoices.filter((invoice) => invoice.status === 'APPROVED').length,
  );
  const draftCarrierCount = $derived(
    invoices.filter((invoice) => invoice.status === 'DRAFT').length,
  );

  // Reconcile form state (per expanded invoice)
  let carrierInvoiceNumber = $state('');
  let invoicedAmounts = $state<Record<string, string>>({});

  // Dispute resolution form state
  let resolution = $state<'ACCEPT_INVOICED' | 'KEEP_EXPECTED'>('ACCEPT_INVOICED');
  let reasonCode = $state('RATE_MISMATCH');
  let disputeNote = $state('');

  // Purchase tax template selector state (DRAFT carrier invoices)
  let purchaseTaxTemplates = $state<TaxTemplateOption[]>([]);
  let purchaseTaxTemplatesLoaded = $state(false);

  async function loadPurchaseTaxTemplates() {
    if (purchaseTaxTemplatesLoaded) return;
    try {
      const result = await api<TaxTemplateOption[]>('/billing/tax-templates', {
        query: { type: 'PURCHASE' },
      });
      purchaseTaxTemplates = result;
      purchaseTaxTemplatesLoaded = true;
    } catch {
      // non-blocking — selector stays empty
    }
  }

  async function applyCarrierTax(invoice: InvoiceRow, taxTemplateId: string | null) {
    try {
      await api(`/billing/invoices/${invoice.id}/tax`, {
        method: 'PATCH',
        body: { taxTemplateId },
      });
      await load();
      // Tax is saved independently; it must not mark typed reconciliation amounts as saved.
      if (!invoices.some((i) => i.id === expanded)) invoiceOpen = false;
    } catch (e) {
      toast.error(
        (mutationError = e instanceof ApiError ? e.message : 'Failed to apply tax template'),
      );
    }
  }

  async function load() {
    const request = ++carrierRequest;
    loadingCarrier = true;
    error = '';
    try {
      const rows = await api<InvoiceRow[]>('/billing/invoices', {
        query: { status: statusFilter || undefined },
      });
      if (request !== carrierRequest) return;
      const target = route.url.searchParams.get('invoice');
      if (
        target &&
        (target !== lastInvoiceTarget || expanded === target) &&
        !rows.some((invoice) => invoice.id === target)
      ) {
        const linked = await api<InvoiceRow>(`/billing/invoices/${encodeURIComponent(target)}`);
        if (request !== carrierRequest) return;
        rows.unshift(linked);
      }
      invoices = rows;
      if (target && target !== lastInvoiceTarget) {
        lastInvoiceTarget = target;
        activeTab = 'carrier';
        const index = rows.findIndex((invoice) => invoice.id === target);
        carrierPage = Math.floor(index / PAGE_SIZE) + 1;
        expand(rows[index]);
      }
      const settings = await api<Record<string, unknown>>('/modules/billing/settings').catch(
        () => null,
      );
      if (request === carrierRequest && settings)
        allowInvoiceDeletion = settings.allowInvoiceDeletion !== false;
    } catch (e) {
      if (request === carrierRequest)
        error = e instanceof ApiError ? e.message : 'Impossible de charger les factures.';
    } finally {
      if (request === carrierRequest) loadingCarrier = false;
    }
  }

  function expand(invoice: InvoiceRow) {
    expanded = invoice.id;
    invoiceOpen = true;
    mutationError = '';
    carrierInvoiceNumber = invoice.carrierInvoiceNumber ?? '';
    invoicedAmounts = Object.fromEntries(
      invoice.lines.map((l) => [l.id, l.invoicedAmount ?? l.amount]),
    );
    // The dispute form state is shared across rows — reset it so invoice A's
    // resolution/note never pre-fills invoice B's form.
    resolution = 'ACCEPT_INVOICED';
    reasonCode = 'RATE_MISMATCH';
    disputeNote = '';
    invoiceDraft = snapshotInvoice();
  }

  async function draft() {
    try {
      const created = await api<InvoiceRow>('/billing/invoices/draft', {
        method: 'POST',
        body: { carrierId: selectedCarrierId },
      });
      toast.success(`${created.invoiceNumber} drafted (${created.lines.length} load(s))`);
      await load();
      invoiceDraft = snapshotInvoice();
      if (!invoices.some((i) => i.id === expanded)) invoiceOpen = false;
    } catch (e) {
      toast.error((mutationError = e instanceof ApiError ? e.message : 'Failed to draft invoice'));
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
                Number.isFinite(parsed) && invoicedAmounts[l.id] !== '' ? parsed : Number(l.amount),
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
      invoiceDraft = snapshotInvoice();
      if (!invoices.some((i) => i.id === expanded)) invoiceOpen = false;
    } catch (e) {
      toast.error((mutationError = e instanceof ApiError ? e.message : 'Failed to reconcile'));
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
      invoiceDraft = snapshotInvoice();
      if (!invoices.some((i) => i.id === expanded)) invoiceOpen = false;
    } catch (e) {
      toast.error(
        (mutationError = e instanceof ApiError ? e.message : 'Failed to resolve dispute'),
      );
    }
  }

  async function approve(invoice: InvoiceRow) {
    try {
      await api(`/billing/invoices/${invoice.id}/approve`, { method: 'POST' });
      toast.success(`${invoice.invoiceNumber} approved (self-billing, no reconciliation)`);
      await load();
      invoiceDraft = snapshotInvoice();
      if (!invoices.some((i) => i.id === expanded)) invoiceOpen = false;
    } catch (e) {
      toast.error((mutationError = e instanceof ApiError ? e.message : 'Failed to approve'));
    }
  }

  async function markPaid(invoice: InvoiceRow) {
    if (
      !(await confirmAction(
        'Comptabiliser le solde complet avec le mode de paiement par défaut ? Pour choisir le mode ou régler une partie du solde, utilisez « Préparer un paiement ». Aucun transfert bancaire ne sera effectué.',
        {
          title: 'Paiement intégral rapide ?',
          confirmLabel: 'Comptabiliser le solde',
          dangerous: false,
        },
      ))
    )
      return;
    try {
      const paidAt = markPaidDate[invoice.id];
      await api(`/billing/invoices/${invoice.id}/mark-paid`, {
        method: 'POST',
        body: paidAt ? { paidAt } : {},
      });
      toast.success(`${invoice.invoiceNumber} marked paid`);
      await load();
      invoiceDraft = snapshotInvoice();
      if (!invoices.some((i) => i.id === expanded)) invoiceOpen = false;
    } catch (e) {
      toast.error((mutationError = e instanceof ApiError ? e.message : 'Failed to mark paid'));
    }
  }

  async function deleteInvoice(invoice: InvoiceRow) {
    if (
      !(await confirmAction(
        `Supprimer le brouillon ${invoice.invoiceNumber} ? Les chargements pourront être regroupés dans une nouvelle facture.`,
      ))
    )
      return;
    try {
      await api(`/billing/invoices/${invoice.id}`, { method: 'DELETE' });
      invoiceOpen = false;
      expanded = '';
      toast.success(`${invoice.invoiceNumber} deleted`);
      await load();
      invoiceDraft = snapshotInvoice();
      if (!invoices.some((i) => i.id === expanded)) invoiceOpen = false;
    } catch (e) {
      toast.error((mutationError = e instanceof ApiError ? e.message : 'Failed to delete invoice'));
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
    const target = route.url.searchParams.get('invoice');
    if (!target) lastInvoiceTarget = '';
    carrierPage = 1;
    void load();
    void loadPurchaseTaxTemplates();
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
    taxAmount: string;
    taxDetail: TaxDetail | null;
    taxTemplateId: string | null;
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

  // Customer statements state
  let customerStatements = $state<StatementRow[]>([]);
  let selectedCustomerId = $state('');
  let statementsStatusFilter = $state('');
  let stmtError = $state('');
  let loadingCustomer = $state(false);

  // Client-side pagination for the customer statements table.
  let customerPage = $state(1);
  const customerTotalPages = $derived(
    Math.max(1, Math.ceil(customerStatements.length / PAGE_SIZE)),
  );
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
  const selectedStatement = $derived(customerStatements.find((stmt) => stmt.id === stmtExpanded));
  // Expanded price detail per line (keyed by line.id)
  let priceDetailExpanded = $state<Record<string, boolean>>({});

  async function loadCustomerData() {
    const request = ++customerRequest;
    loadingCustomer = true;
    stmtError = '';
    try {
      const stmts = await api<StatementRow[]>('/billing/customer-invoices', {
        query: {
          status: statementsStatusFilter || undefined,
        },
      });
      if (request !== customerRequest) return;
      customerStatements = stmts;
      const target = route.url.searchParams.get('statement');
      if (target && (target !== lastStatementTarget || stmtExpanded === target)) {
        let index = stmts.findIndex((s) => s.id === target);
        if (index < 0) {
          const linked = await api<StatementRow>(
            `/billing/customer-invoices/${encodeURIComponent(target)}`,
          );
          if (request !== customerRequest) return;
          customerStatements = [linked, ...stmts];
          index = 0;
        }
        customerPage = Math.floor(index / PAGE_SIZE) + 1;
        stmtExpanded = target;
        if (target !== lastStatementTarget) {
          statementOpen = true;
          lastStatementTarget = target;
        }
      }
    } catch (e) {
      if (request === customerRequest)
        stmtError = e instanceof ApiError ? e.message : 'Impossible de charger les relevés.';
    } finally {
      if (request === customerRequest) loadingCustomer = false;
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
      toast.error(
        (mutationError = e instanceof ApiError ? e.message : 'Failed to preview billable orders'),
      );
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
      toast.success(`${result.invoices.length} statement(s) created (${currencies})`);
      // Clear preview
      previewRatable = [];
      previewUnratable = [];
      previewDone = false;
      selectedCustomerId = '';
      await loadCustomerData();
    } catch (e) {
      toast.error(
        (mutationError = e instanceof ApiError ? e.message : 'Failed to generate statements'),
      );
    }
  }

  function expandStmt(stmt: StatementRow) {
    stmtExpanded = stmt.id;
    statementOpen = true;
    mutationError = '';
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
      toast.error(
        (mutationError = e instanceof ApiError ? e.message : 'Failed to approve statement'),
      );
    }
  }

  async function sendStatement(stmt: StatementRow) {
    if (
      !(await confirmAction(
        `Send statement ${stmt.invoiceNumber} by email to the customer contact?`,
      ))
    )
      return;
    try {
      await api(`/billing/customer-invoices/${stmt.id}/send`, { method: 'POST' });
      toast.success(`${stmt.invoiceNumber} sent`);
      await loadCustomerData();
    } catch (e) {
      toast.error((mutationError = e instanceof ApiError ? e.message : 'Failed to send statement'));
    }
  }

  async function payStatement(stmt: StatementRow) {
    if (
      !(await confirmAction(
        'Comptabiliser le solde complet avec le mode de paiement par défaut ? Pour choisir le mode ou un montant partiel, utilisez « Préparer un encaissement ». Aucun transfert bancaire ne sera effectué.',
        {
          title: 'Encaissement intégral rapide ?',
          confirmLabel: 'Comptabiliser le solde',
          dangerous: false,
        },
      ))
    )
      return;
    try {
      await api(`/billing/customer-invoices/${stmt.id}/pay`, { method: 'POST' });
      toast.success(`${stmt.invoiceNumber} marked paid`);
      await loadCustomerData();
      if (!customerStatements.some((s) => s.id === stmtExpanded)) statementOpen = false;
    } catch (e) {
      toast.error((mutationError = e instanceof ApiError ? e.message : 'Failed to mark paid'));
    }
  }

  async function deleteStatement(stmt: StatementRow) {
    if (
      !(await confirmAction(
        `Supprimer le relevé ${stmt.invoiceNumber} ? Les ordres pourront être regroupés dans un nouveau relevé.`,
      ))
    )
      return;
    try {
      await api(`/billing/customer-invoices/${stmt.id}`, { method: 'DELETE' });
      statementOpen = false;
      stmtExpanded = '';
      toast.success(`${stmt.invoiceNumber} deleted`);
      await loadCustomerData();
    } catch (e) {
      toast.error(
        (mutationError = e instanceof ApiError ? e.message : 'Failed to delete statement'),
      );
    }
  }

  // Tax template selector state (for DRAFT statements)
  let taxTemplates = $state<TaxTemplateOption[]>([]);
  let taxTemplatesLoaded = $state(false);

  async function loadTaxTemplates() {
    if (taxTemplatesLoaded) return;
    try {
      const result = await api<TaxTemplateOption[]>('/billing/tax-templates', {
        query: { type: 'SALES' },
      });
      taxTemplates = result;
      taxTemplatesLoaded = true;
    } catch {
      // non-blocking — selector just stays empty
    }
  }

  async function applyTax(stmt: StatementRow, taxTemplateId: string | null) {
    try {
      await api(`/billing/customer-invoices/${stmt.id}/tax`, {
        method: 'PATCH',
        body: { taxTemplateId },
      });
      await loadCustomerData();
    } catch (e) {
      toast.error(
        (mutationError = e instanceof ApiError ? e.message : 'Failed to apply tax template'),
      );
    }
  }

  // Load customer tab data when switching to it (once)
  let customerDataLoaded = $state(false);
  $effect(() => {
    if (activeTab === 'customer' && !customerDataLoaded) {
      customerDataLoaded = true;
      void loadCustomerData();
      void loadTaxTemplates();
    }
  });

  // Reload customer statements when status filter changes (only if tab was loaded)
  $effect(() => {
    void statementsStatusFilter;
    const target = route.url.searchParams.get('statement');
    if (target) activeTab = 'customer';
    else lastStatementTarget = '';
    customerPage = 1;
    if (customerDataLoaded) {
      void loadCustomerData();
    }
  });
</script>

<PageHeader
  title="Factures et relevés"
  subtitle="Rapprocher les factures transporteurs et préparer la facturation client."
  >{#snippet actions()}<Button variant="secondary" href="/billing/payments">Paiements</Button
    >{/snippet}</PageHeader
>

<div
  class="mb-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-muted"
  aria-label="Résumé de la vue"
>
  {#if activeTab === 'carrier'}
    <span
      ><strong class="font-mono font-medium text-ink">{draftCarrierCount}</strong> brouillons</span
    >
    <span
      ><strong class="font-mono font-medium text-ink">{disputedCarrierCount}</strong> en litige</span
    >
    <span
      ><strong class="font-mono font-medium text-ink">{approvedCarrierCount}</strong> approuvées</span
    >
  {:else}
    <span
      ><strong class="font-mono font-medium text-ink"
        >{customerStatements.filter((s) => s.status === 'DRAFT').length}</strong
      > brouillons</span
    >
    <span
      ><strong class="font-mono font-medium text-ink"
        >{customerStatements.filter((s) => s.status === 'APPROVED' || s.status === 'SENT')
          .length}</strong
      > approuvés / envoyés</span
    >
    <span
      ><strong class="font-mono font-medium text-ink"
        >{customerStatements.filter((s) => s.status === 'PAID').length}</strong
      > payés</span
    >
  {/if}
  <span class="text-xs">Dans les résultats chargés · filtres appliqués</span>
</div>

<Tabs
  tabs={[
    { id: 'carrier', label: 'Factures transporteurs' },
    { id: 'customer', label: 'Relevés clients' },
  ]}
  bind:active={activeTab}
>
  {#snippet children()}
    <!-- ══════════════════════════════════════════════════════════════ CARRIER TAB -->
    {#if activeTab === 'carrier'}
      <FilterBar>
        <div class="w-36">
          <Select bind:value={statusFilter} aria-label="Statut des factures transporteurs">
            <option value="">Tous les statuts</option>
            <option value="DRAFT">Draft</option>
            <option value="DISPUTED">Disputed</option>
            <option value="APPROVED">Approved</option>
            <option value="PAID">Paid</option>
          </Select>
        </div>
        <Button variant="secondary" onclick={exportCsv}>Export CSV</Button>
        <div class="w-56">
          <EntityPicker
            endpoint="/transportation/carriers"
            label="Transporteur à facturer"
            labelKey="name"
            placeholder="Transporteur à facturer…"
            bind:value={selectedCarrierId}
          />
        </div>
        <Button
          disabled={!selectedCarrierId || !canManageInvoices}
          loading={invoiceBusy}
          onclick={() => perform(draft)}>Générer un brouillon</Button
        >
      </FilterBar>

      <p class="mb-4 max-w-3xl text-sm leading-relaxed text-ink-muted">
        Regroupez les chargements terminés non facturés, puis rapprochez leur coût prévu de la
        facture du transporteur. Un écart hors tolérance ouvre un litige.
      </p>

      <ErrorNotice message={error} onretry={load} />
      {#if !invoiceOpen}<ErrorNotice message={mutationError} />{/if}

      {#if loadingCarrier}
        <Card padded={false}><Skeleton rows={6} /></Card>
      {:else if !error}
        <Table>
          {#snippet head()}
            <th>Facture</th><th>Transporteur</th><th>Prévu</th><th>Facturé</th>
            <th>Écart (net / brut)</th><th>Statut</th>
          {/snippet}
          {#snippet body()}
            {#each pagedInvoices as invoice (invoice.id)}
              <tr>
                <td>
                  <button
                    class="font-semibold text-accent hover:underline bg-transparent border-none p-0 cursor-pointer text-sm"
                    onclick={() => expand(invoice)}>{invoice.invoiceNumber}</button
                  >
                </td>
                <td>{invoice.carrier.name}</td>
                <td>{Number(invoice.totalAmount).toLocaleString('fr-CA')} {invoice.currency}</td>
                <td>
                  {invoice.invoicedTotal !== null
                    ? `${Number(invoice.invoicedTotal).toLocaleString('fr-CA')} ${invoice.currency}`
                    : '—'}
                </td>
                <td>
                  {invoice.varianceGross !== null
                    ? `${Number(invoice.varianceTotal).toLocaleString('fr-CA')} / ${Number(invoice.varianceGross).toLocaleString('fr-CA')}`
                    : '—'}
                </td>
                <td><Badge tone={toneFor(invoice.status)}>{labelFor(invoice.status)}</Badge></td>
              </tr>
            {:else}
              <tr
                ><td colspan="6"
                  ><EmptyState
                    title="No carrier invoices yet"
                    message="Generate a draft from completed loads, then reconcile it against the carrier invoice to catch variance before payment."
                  >
                    {#snippet children()}<Button variant="secondary" href="/loads"
                        >Review completed loads</Button
                      >{/snippet}</EmptyState
                  ></td
                ></tr
              >
            {/each}
          {/snippet}
        </Table>

        {#if invoices.length > PAGE_SIZE}
          <div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
            <span class="font-mono text-xs"
              >{(carrierPage - 1) * PAGE_SIZE + 1}–{Math.min(
                carrierPage * PAGE_SIZE,
                invoices.length,
              )} sur {invoices.length}</span
            >
            <div class="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={carrierPage <= 1}
                onclick={() => {
                  carrierPage = Math.max(1, carrierPage - 1);
                }}>Précédent</Button
              >
              <span class="font-mono text-xs">Page {carrierPage} / {carrierTotalPages}</span>
              <Button
                variant="secondary"
                disabled={carrierPage >= carrierTotalPages}
                onclick={() => {
                  carrierPage = Math.min(carrierTotalPages, carrierPage + 1);
                }}>Suivant</Button
              >
            </div>
          </div>
        {/if}
      {/if}

      <!-- ══════════════════════════════════════════════════════════ CUSTOMER TAB -->
    {:else}
      <!-- Billable preview panel -->
      <Card>
        <h2 class="text-sm font-bold text-ink mb-3">Préparer les relevés clients</h2>
        <div class="flex gap-2 items-center flex-wrap">
          <div class="w-64">
            <EntityPicker
              endpoint="/transportation/customers"
              label="Client à facturer"
              labelKey="name"
              detailKey="code"
              placeholder="Client à facturer…"
              bind:value={selectedCustomerId}
            />
          </div>
          <Button
            variant="secondary"
            disabled={!selectedCustomerId || previewLoading || invoiceBusy || !canManageStatements}
            onclick={previewBillable}
          >
            {previewLoading ? 'Loading…' : 'Prévisualiser les ordres facturables'}
          </Button>
          {#if previewDone && previewRatable.length > 0}
            <Button
              disabled={!canManageStatements}
              loading={invoiceBusy}
              onclick={() => perform(generateStatements)}
            >
              Generate statements ({previewRatable.length} order{previewRatable.length !== 1
                ? 's'
                : ''})
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
                        <td class="text-right"
                          >{Number(row.amount).toLocaleString('fr-CA')} {row.currency}</td
                        >
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
        <span class="text-sm text-ink-muted">Relevés clients</span>
        <div class="ml-auto w-36">
          <Select bind:value={statementsStatusFilter} aria-label="Statut des relevés clients">
            <option value="">Tous les statuts</option>
            <option value="DRAFT">Draft</option>
            <option value="APPROVED">Approved</option>
            <option value="SENT">Sent</option>
            <option value="PAID">Paid</option>
          </Select>
        </div>
      </FilterBar>

      <ErrorNotice message={stmtError} onretry={loadCustomerData} />
      {#if !statementOpen}<ErrorNotice message={mutationError} />{/if}

      {#if loadingCustomer}
        <Card padded={false}><Skeleton rows={6} /></Card>
      {:else if !stmtError}
        <Table>
          {#snippet head()}
            <th>Relevé</th><th>Client</th><th>Statut</th><th>Devise</th>
            <th class="text-right">Total</th><th>Créé le</th>
          {/snippet}
          {#snippet body()}
            {#each pagedStatements as stmt (stmt.id)}
              <tr>
                <td>
                  <button
                    class="font-semibold text-accent hover:underline bg-transparent border-none p-0 cursor-pointer text-sm"
                    onclick={() => expandStmt(stmt)}>{stmt.invoiceNumber}</button
                  >
                </td>
                <td>{stmt.customer.name}</td>
                <td><Badge tone={toneFor(stmt.status)}>{labelFor(stmt.status)}</Badge></td>
                <td>{stmt.currency}</td>
                <td class="text-right"
                  >{Number(stmt.totalAmount).toLocaleString('fr-CA')} {stmt.currency}</td
                >
                <td>{formatDate(stmt.createdAt)}</td>
              </tr>
            {:else}
              <tr><td colspan="6"><EmptyState message="No customer statements yet." /></td></tr>
            {/each}
          {/snippet}
        </Table>

        {#if customerStatements.length > PAGE_SIZE}
          <div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
            <span class="font-mono text-xs"
              >{(customerPage - 1) * PAGE_SIZE + 1}–{Math.min(
                customerPage * PAGE_SIZE,
                customerStatements.length,
              )} sur {customerStatements.length}</span
            >
            <div class="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={customerPage <= 1}
                onclick={() => {
                  customerPage = Math.max(1, customerPage - 1);
                }}>Précédent</Button
              >
              <span class="font-mono text-xs">Page {customerPage} / {customerTotalPages}</span>
              <Button
                variant="secondary"
                disabled={customerPage >= customerTotalPages}
                onclick={() => {
                  customerPage = Math.min(customerTotalPages, customerPage + 1);
                }}>Suivant</Button
              >
            </div>
          </div>
        {/if}
      {/if}
    {/if}
  {/snippet}
</Tabs>
<Drawer
  bind:open={invoiceOpen}
  title={selectedInvoice?.invoiceNumber ?? 'Facture transporteur'}
  width="xl"
  dismissible={!invoiceBusy}
  onbeforeclose={beforeInvoiceClose}
>
  {#if selectedInvoice}
    {@const invoice = selectedInvoice}
    {#if invoice.incomingAudit && $auth?.user.permissions.includes(PERMISSIONS.BILLING.FREIGHT_AUDIT_READ)}
      <div class="mb-4">
        <Button
          variant="secondary"
          href={`/billing/freight-audit/${encodeURIComponent(invoice.incomingAudit.id)}`}
          >Ouvrir l’audit transporteur</Button
        >
      </div>
    {/if}
    <div class="mb-5 flex flex-wrap items-center gap-2">
      <Badge tone={toneFor(invoice.status)}>{labelFor(invoice.status)}</Badge><span class="text-sm"
        >{invoice.carrier.name}</span
      ><span class="text-xs text-ink-muted">· {invoice.currency}</span>
    </div>
    <ErrorNotice message={mutationError} />
    <fieldset disabled={invoiceBusy || !canManageInvoices} class="min-w-0 space-y-4">
      <div class="relative overflow-x-auto">
        <table class="w-full text-sm">
          <thead
            ><tr class="text-left text-xs text-ink-muted"
              ><th>Description / chargement</th><th class="text-right">Prévu</th><th
                class="text-right">Facturé</th
              ></tr
            ></thead
          >
          <tbody>
            {#each invoice.lines as line (line.id)}
              <tr class="border-b border-edge last:border-0">
                <td class="py-1.5 pr-4"
                  >{line.description}{#if line.load}<a
                      class="mt-1 block font-mono text-xs text-accent hover:underline"
                      href={`/loads/${line.load.id}`}>{line.load.loadNumber}</a
                    >{/if}</td
                >
                <td class="py-1.5 text-right pr-4 text-ink-muted">
                  {Number(line.amount).toLocaleString('fr-CA')}
                  {invoice.currency}
                </td>
                <td class="py-1.5 text-right w-40">
                  {#if invoice.status === 'DRAFT' || invoice.status === 'DISPUTED'}
                    <input
                      aria-label={`Montant facturé · ${line.description}`}
                      type="number"
                      step="0.01"
                      bind:value={invoicedAmounts[line.id]}
                      class="w-28 rounded border border-edge bg-surface px-2 py-0.5 text-right text-sm text-ink focus:border-accent focus:outline-none"
                    />
                  {:else if line.invoicedAmount !== null}
                    {Number(line.invoicedAmount).toLocaleString('fr-CA')}
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
      </div>

      {#if invoice.status === 'DRAFT' || invoice.status === 'DISPUTED'}
        <div class="flex gap-2 items-center flex-wrap">
          <Input
            aria-label="Numéro de facture transporteur"
            placeholder="Numéro de facture transporteur"
            bind:value={carrierInvoiceNumber}
          />
          <Button
            variant="primary"
            disabled={!carrierInvoiceNumber}
            onclick={() => perform(() => reconcile(invoice))}
          >
            {invoice.status === 'DISPUTED' ? 'Re-reconcile (corrected invoice)' : 'Reconcile'}
          </Button>
        </div>
      {/if}

      {#if invoice.status === 'DISPUTED'}
        <div class="flex gap-2 items-center flex-wrap">
          <div class="w-44">
            <Select bind:value={resolution} aria-label="Résolution du litige">
              <option value="ACCEPT_INVOICED">Pay invoiced amount</option>
              <option value="KEEP_EXPECTED">Pay expected amount</option>
            </Select>
          </div>
          <div class="w-48">
            <Select bind:value={reasonCode} aria-label="Motif du litige">
              {#each REASON_CODES as code (code)}<option value={code}>{code}</option>{/each}
            </Select>
          </div>
          <div class="flex-1 min-w-40">
            <Input
              aria-label="Note du litige"
              placeholder="Note (facultatif)"
              bind:value={disputeNote}
            />
          </div>
          <Button variant="danger" onclick={() => perform(() => resolve(invoice))}
            >Résoudre le litige</Button
          >
        </div>
      {/if}

      {#if invoice.disputeReasonCode}
        <p class="text-sm text-ink-muted">
          Dispute: {invoice.disputeReasonCode}{invoice.disputeNote
            ? ` — ${invoice.disputeNote}`
            : ''}
        </p>
      {/if}

      <!-- Tax breakdown / totals -->
      {#if Number(invoice.taxAmount) > 0 && invoice.taxDetail}
        {@const taxAmt = Number(invoice.taxAmount)}
        {@const total = Number(invoice.totalAmount)}
        {@const net = total - taxAmt}
        <div class="rounded-md border border-edge bg-surface p-3 space-y-1 text-sm">
          <div class="flex justify-between text-ink-muted">
            <span>Net</span>
            <span>{net.toLocaleString('fr-CA')} {invoice.currency}</span>
          </div>
          {#each invoice.taxDetail.lines as tl (tl.description)}
            <div class="flex justify-between text-ink-muted">
              <span>{tl.description} ({tl.rate}%)</span>
              <span>{Number(tl.amount).toLocaleString('fr-CA')} {invoice.currency}</span>
            </div>
          {/each}
          <div class="flex justify-between font-semibold border-t border-edge pt-1 text-ink">
            <span>Total</span>
            <span>{total.toLocaleString('fr-CA')} {invoice.currency}</span>
          </div>
        </div>
      {:else}
        <div class="rounded-md border border-edge bg-surface p-3 text-sm">
          <div class="flex justify-between font-semibold text-ink">
            <span>Total</span>
            <span
              >{Number(invoice.totalAmount).toLocaleString('fr-CA')}
              {invoice.currency}</span
            >
          </div>
        </div>
      {/if}

      <!-- Tax template selector (DRAFT only) -->
      {#if invoice.status === 'DRAFT'}
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs text-ink-muted">Gabarit de taxe :</span>
          <div class="w-56">
            <Select
              aria-label="Gabarit de taxe"
              value={invoice.taxTemplateId ?? ''}
              onchange={(e) => {
                const val = (e.target as HTMLSelectElement).value;
                void perform(() => applyCarrierTax(invoice, val === '' ? null : val));
              }}
            >
              <option value="">Aucune taxe</option>
              {#each purchaseTaxTemplates as t (t.id)}
                <option value={t.id}>{t.name}</option>
              {/each}
            </Select>
          </div>
        </div>
      {/if}
    </fieldset>
  {/if}
  {#snippet footer()}
    {#if selectedInvoice}
      {@const invoice = selectedInvoice}
      <div class="flex flex-wrap items-center gap-2">
        {#if canPay && invoice.status === 'APPROVED'}<Button
            href={paymentLink('CARRIER', invoice.carrier.id, invoice.id)}
            >Préparer un paiement</Button
          >{/if}
        {#if canManageInvoices}<fieldset
            disabled={invoiceBusy}
            class="flex min-w-0 flex-wrap items-center gap-2"
          >
            {#if invoice.status === 'DRAFT'}
              <Button variant="secondary" onclick={() => perform(() => approve(invoice))}
                >Approuver sans rapprochement</Button
              >
              {#if allowInvoiceDeletion}
                <Button variant="danger" onclick={() => perform(() => deleteInvoice(invoice))}
                  >Supprimer le brouillon</Button
                >
              {/if}
            {:else if invoice.status === 'APPROVED'}
              <input
                type="date"
                bind:value={markPaidDate[invoice.id]}
                aria-label="Date du paiement intégral (facultatif)"
                class="rounded border border-edge bg-surface px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none"
              />
              <Button variant="secondary" onclick={() => perform(() => markPaid(invoice))}
                >Paiement intégral rapide</Button
              >
            {/if}
          </fieldset>{/if}
      </div>
    {/if}
  {/snippet}
</Drawer>
<Drawer
  bind:open={statementOpen}
  title={selectedStatement?.invoiceNumber ?? 'Relevé client'}
  width="xl"
  dismissible={!invoiceBusy}
>
  {#if selectedStatement}
    {@const stmt = selectedStatement}
    <div class="mb-5 flex flex-wrap items-center gap-2">
      <Badge tone={toneFor(stmt.status)}>{labelFor(stmt.status)}</Badge><span class="text-sm"
        >{stmt.customer.name}</span
      ><span class="text-xs text-ink-muted">· {stmt.currency}</span>
    </div>
    <ErrorNotice message={mutationError} />
    <div class="min-w-0 space-y-4">
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
              <td
                >{#if line.transportOrder}<a
                    class="font-mono text-accent hover:underline"
                    href={`/transport-orders/${line.transportOrder.id}`}
                    >{line.transportOrder.orderNumber}</a
                  >{:else}—{/if}</td
              >
              <td>{line.description}</td>
              <td class="text-right"
                >{Number(line.amount).toLocaleString('fr-CA')} {stmt.currency}</td
              >
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
                            <td class="py-0.5 text-right"
                              >{pline.amount.toLocaleString('fr-CA')} {stmt.currency}</td
                            >
                          </tr>
                        {/each}
                        <tr class="border-t border-edge font-semibold">
                          <td class="py-0.5">Total</td>
                          <td class="py-0.5 text-right"
                            >{pd.result.total.toLocaleString('fr-CA')} {stmt.currency}</td
                          >
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

      <!-- Tax breakdown / totals -->
      {#if Number(stmt.taxAmount) > 0 && stmt.taxDetail}
        {@const taxAmt = Number(stmt.taxAmount)}
        {@const total = Number(stmt.totalAmount)}
        {@const net = total - taxAmt}
        <div class="rounded-md border border-edge bg-surface p-3 space-y-1 text-sm">
          <div class="flex justify-between text-ink-muted">
            <span>Net</span>
            <span>{net.toLocaleString('fr-CA')} {stmt.currency}</span>
          </div>
          {#each stmt.taxDetail.lines as tl (tl.description)}
            <div class="flex justify-between text-ink-muted">
              <span>{tl.description} ({tl.rate}%)</span>
              <span>{Number(tl.amount).toLocaleString('fr-CA')} {stmt.currency}</span>
            </div>
          {/each}
          <div class="flex justify-between font-semibold border-t border-edge pt-1 text-ink">
            <span>Total</span>
            <span>{total.toLocaleString('fr-CA')} {stmt.currency}</span>
          </div>
        </div>
      {:else}
        <div class="rounded-md border border-edge bg-surface p-3 text-sm">
          <div class="flex justify-between font-semibold text-ink">
            <span>Total</span>
            <span>{Number(stmt.totalAmount).toLocaleString('fr-CA')} {stmt.currency}</span>
          </div>
        </div>
      {/if}

      <!-- Tax template selector (DRAFT only) -->
      {#if stmt.status === 'DRAFT'}
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs text-ink-muted">Gabarit de taxe :</span>
          <div class="w-56">
            <Select
              disabled={invoiceBusy || !canManageStatements}
              aria-label="Gabarit de taxe"
              value={stmt.taxTemplateId ?? ''}
              onchange={(e) => {
                const val = (e.target as HTMLSelectElement).value;
                void perform(() => applyTax(stmt, val === '' ? null : val));
              }}
            >
              <option value="">Aucune taxe</option>
              {#each taxTemplates as t (t.id)}
                <option value={t.id}>{t.name}</option>
              {/each}
            </Select>
          </div>
        </div>
      {/if}
    </div>
  {/if}
  {#snippet footer()}
    {#if selectedStatement}
      {@const stmt = selectedStatement}
      <div class="flex flex-wrap items-center gap-2">
        {#if canPay && (stmt.status === 'APPROVED' || stmt.status === 'SENT')}<Button
            href={paymentLink('CUSTOMER', stmt.customer.id, stmt.id)}
            >Préparer un encaissement</Button
          >{/if}
        {#if canManageStatements}<fieldset
            disabled={invoiceBusy}
            class="flex min-w-0 flex-wrap items-center gap-2"
          >
            {#if stmt.status === 'DRAFT'}
              <Button variant="primary" onclick={() => perform(() => approveStatement(stmt))}
                >Approuver</Button
              >
              <Button variant="danger" onclick={() => perform(() => deleteStatement(stmt))}
                >Supprimer le brouillon</Button
              >
            {:else if stmt.status === 'APPROVED'}
              <Button variant="primary" onclick={() => perform(() => sendStatement(stmt))}
                >Envoyer</Button
              >
            {:else if stmt.status === 'SENT'}
              <Button variant="secondary" onclick={() => perform(() => payStatement(stmt))}
                >Paiement intégral rapide</Button
              >
            {/if}
          </fieldset>{/if}
      </div>
    {/if}
  {/snippet}
</Drawer>
