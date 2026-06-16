<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Card, EmptyState, ErrorNotice, PageHeader, Skeleton } from '$lib/components/ui';

  interface CarrierInvoice {
    id: string;
    status: string;
    currency: string;
    totalAmount: string;
    varianceGross: string | null;
  }
  interface CustomerInvoice {
    id: string;
    status: string;
    currency: string;
    totalAmount: string;
  }
  interface IncomingInvoice {
    id: string;
    status: string;
    currency: string;
    chargedTotal: string;
    varianceGross: string | null;
    recoveredAmount: string | null;
    carrier: { name: string };
  }
  interface Savings { tenantTotal: string }

  let carrierInvoices = $state<CarrierInvoice[]>([]);
  let customerInvoices = $state<CustomerInvoice[]>([]);
  let incomingInvoices = $state<IncomingInvoice[]>([]);
  let savings = $state<Savings | null>(null);
  let loading = $state(true);
  let error = $state('');

  const receivableTotal = $derived(sumMoney(customerInvoices.map((i) => i.totalAmount)));
  const payableTotal = $derived(sumMoney(carrierInvoices.map((i) => i.totalAmount)));
  const disputedCount = $derived([
    ...carrierInvoices.filter((i) => i.status === 'DISPUTED'),
    ...incomingInvoices.filter((i) => i.status === 'DISPUTED' || i.status === 'FLAGGED'),
  ].length);
  const draftReceivables = $derived(customerInvoices.filter((i) => i.status === 'DRAFT').length);
  const paidReceivables = $derived(customerInvoices.filter((i) => i.status === 'PAID').length);
  const auditRisk = $derived(sumMoney(incomingInvoices.map((i) => i.varianceGross ?? '0')));

  function sumMoney(values: string[]): string {
    const total = values.reduce((sum, raw) => sum + Number(raw || 0), 0);
    return total.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const [carrier, customer, incoming, sav] = await Promise.all([
        api<CarrierInvoice[]>('/billing/invoices'),
        api<CustomerInvoice[]>('/billing/customer-invoices'),
        api<IncomingInvoice[]>('/freight-audit/incoming-invoices'),
        api<Savings>('/freight-audit/savings', { query: { days: 30 } }),
      ]);
      carrierInvoices = carrier;
      customerInvoices = customer;
      incomingInvoices = incoming;
      savings = sav;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement finance';
    } finally {
      loading = false;
    }
  }

  $effect(() => { void load(); });
</script>

<PageHeader
  title="Finance / Ledger"
  subtitle="Receivables, payables, audit de factures, marge et cash readiness — pas seulement une page de factures TMS."
/>

{#if error}<ErrorNotice message={error} />{/if}

<section class="mb-5 overflow-hidden rounded-card border border-edge bg-ink text-white shadow-sm">
  <div class="grid gap-5 p-5 lg:grid-cols-[1.1fr_0.9fr] lg:p-6">
    <div>
      <p class="text-xs font-semibold tracking-[0.24em] text-white/55 uppercase">Business money layer</p>
      <h1 class="mt-2 max-w-3xl text-2xl font-bold tracking-tight sm:text-3xl">
        Finance devient le module qui contrôle l’argent, pas seulement les loads facturés.
      </h1>
      <p class="mt-3 max-w-2xl text-sm leading-6 text-white/68">
        Les workflows Transport alimentent Finance, mais le module doit aussi porter AR/AP, paiements,
        marges, litiges, taxes et intégrations comptables. Cette première home regroupe les surfaces déjà livrées.
      </p>
    </div>
    <div class="grid grid-cols-2 gap-2 text-sm">
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Receivables</p>
        <p class="mt-1 text-2xl font-semibold">{loading ? '—' : receivableTotal}</p>
      </div>
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Payables</p>
        <p class="mt-1 text-2xl font-semibold">{loading ? '—' : payableTotal}</p>
      </div>
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Disputes / risk</p>
        <p class="mt-1 text-2xl font-semibold">{loading ? '—' : disputedCount}</p>
      </div>
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Recovered 30j</p>
        <p class="mt-1 text-2xl font-semibold">{loading ? '—' : Number(savings?.tenantTotal ?? 0).toLocaleString()}</p>
      </div>
    </div>
  </div>
</section>

{#if loading}
  <div class="grid gap-4 lg:grid-cols-3">
    {#each Array(3) as _, i (i)}<Card><Skeleton /></Card>{/each}
  </div>
{:else}
  <div class="grid gap-4 lg:grid-cols-3">
    <Card>
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Receivables</p>
          <h2 class="mt-1 text-lg font-bold text-ink">Customer invoices</h2>
        </div>
        <Badge tone={draftReceivables ? 'warn' : 'ok'}>{draftReceivables} draft</Badge>
      </div>
      <p class="mt-3 text-sm leading-6 text-ink-muted">
        Relevés clients, statuts d’envoi/paiement et bientôt taxes, termes, aging et intégration comptable.
      </p>
      <div class="mt-4 flex items-center justify-between rounded-inner bg-surface-muted p-3 text-sm">
        <span class="text-ink-muted">Payées</span><span class="font-semibold text-ink">{paidReceivables}</span>
      </div>
      <a href="/invoices" class="mt-4 inline-flex text-sm font-semibold text-accent hover:underline">Ouvrir les factures →</a>
    </Card>

    <Card>
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Payables</p>
          <h2 class="mt-1 text-lg font-bold text-ink">Vendor / carrier invoices</h2>
        </div>
        <Badge tone={carrierInvoices.some((i) => i.status === 'DISPUTED') ? 'danger' : 'neutral'}>{carrierInvoices.length}</Badge>
      </div>
      <p class="mt-3 text-sm leading-6 text-ink-muted">
        Factures fournisseurs/transporteurs, rapprochement, approbation, paiement et litiges contrôlés.
      </p>
      <div class="mt-4 flex items-center justify-between rounded-inner bg-surface-muted p-3 text-sm">
        <span class="text-ink-muted">Total attendu</span><span class="font-semibold text-ink">{payableTotal}</span>
      </div>
      <a href="/invoices" class="mt-4 inline-flex text-sm font-semibold text-accent hover:underline">Voir AP / carrier →</a>
    </Card>

    <Card>
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Audit</p>
          <h2 class="mt-1 text-lg font-bold text-ink">Freight audit agent lane</h2>
        </div>
        <Badge tone={disputedCount ? 'danger' : 'ok'}>{disputedCount} flagged</Badge>
      </div>
      <p class="mt-3 text-sm leading-6 text-ink-muted">
        Le freight audit reste une spécialité Finance : anomalies, variance, disputes et économies récupérées.
      </p>
      <div class="mt-4 flex items-center justify-between rounded-inner bg-surface-muted p-3 text-sm">
        <span class="text-ink-muted">Variance brute</span><span class="font-semibold text-ink">{auditRisk}</span>
      </div>
      <a href="/billing/freight-audit" class="mt-4 inline-flex text-sm font-semibold text-accent hover:underline">Ouvrir l’audit →</a>
    </Card>
  </div>
{/if}

<div class="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
  <Card>
    <h2 class="text-base font-bold text-ink">Roadmap Finance / Ledger</h2>
    <div class="mt-4 grid gap-3 md:grid-cols-2">
      {#each [
        ['Receivables', 'Aging, taxes, payment terms, customer statements.'],
        ['Payables', 'Vendor invoices, approvals, duplicate detection.'],
        ['Margin', 'Profit by customer, project, lane, asset and warehouse job.'],
        ['Accounting', 'QuickBooks/Xero/Sage/Acomba mappings and sync logs.'],
      ] as item (item[0])}
        <div class="rounded-inner border border-edge-soft bg-surface-muted p-3">
          <p class="text-sm font-semibold text-ink">{item[0]}</p>
          <p class="mt-1 text-xs leading-5 text-ink-muted">{item[1]}</p>
        </div>
      {/each}
    </div>
  </Card>

  <Card>
    <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Assigned employee</p>
    <h2 class="mt-1 text-lg font-bold text-ink">Finance operator agent</h2>
    <p class="mt-3 text-sm leading-6 text-ink-muted">
      Surveille les factures entrantes, ouvre les litiges sous gouvernance, signale la marge anormale et prépare les actions à approuver.
    </p>
    <a href="/agents" class="mt-4 inline-flex text-sm font-semibold text-accent hover:underline">Voir les agents →</a>
  </Card>
</div>

{#if !loading && !carrierInvoices.length && !customerInvoices.length && !incomingInvoices.length}
  <div class="mt-5">
    <EmptyState message="Aucune donnée Finance dans la seed actuelle — le module est maintenant cadré, mais il faut enrichir la seed pour le rendre vivant." />
  </div>
{/if}
