<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Card, EmptyState, ErrorNotice, PageHeader, Skeleton } from '$lib/components/ui';
  import AgentPanel from '$lib/components/AgentPanel.svelte';

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
  interface Savings {
    tenantTotal: string;
  }

  let carrierInvoices = $state<CarrierInvoice[]>([]);
  let customerInvoices = $state<CustomerInvoice[]>([]);
  let incomingInvoices = $state<IncomingInvoice[]>([]);
  let savings = $state<Savings | null>(null);
  let loading = $state(true);
  let error = $state('');

  const receivableTotal = $derived(sumMoney(customerInvoices.map((i) => i.totalAmount)));
  const payableTotal = $derived(sumMoney(carrierInvoices.map((i) => i.totalAmount)));
  const disputedCount = $derived(
    [
      ...carrierInvoices.filter((i) => i.status === 'DISPUTED'),
      ...incomingInvoices.filter((i) => i.status === 'DISPUTED' || i.status === 'FLAGGED'),
    ].length,
  );
  const draftReceivables = $derived(customerInvoices.filter((i) => i.status === 'DRAFT').length);
  const paidReceivables = $derived(customerInvoices.filter((i) => i.status === 'PAID').length);
  const auditRisk = $derived(sumMoney(incomingInvoices.map((i) => i.varianceGross ?? '0')));

  function sumMoney(values: string[]): string {
    const total = values.reduce((sum, raw) => sum + Number(raw || 0), 0);
    return total.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  function money(value: string | null, currency: string): string {
    return `${Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
  }

  interface WorkItem {
    tone: 'danger' | 'warn' | 'info';
    label: string;
    detail: string;
    href: string;
  }
  // What should the operator act on next? Built from live AR/AP/audit data.
  const worklist = $derived.by(() => {
    const items: WorkItem[] = [];
    for (const inv of incomingInvoices) {
      if (inv.status === 'DISPUTED' || inv.status === 'FLAGGED') {
        items.push({
          tone: 'danger',
          label: `Litige — ${inv.carrier?.name ?? 'transporteur'}`,
          detail: `Écart ${money(inv.varianceGross, inv.currency)}`,
          href: '/billing/freight-audit',
        });
      }
    }
    for (const inv of carrierInvoices) {
      if (inv.status === 'DISPUTED') {
        items.push({
          tone: 'danger',
          label: 'Facture transporteur en litige',
          detail: money(inv.totalAmount, inv.currency),
          href: '/invoices',
        });
      }
    }
    const drafts = customerInvoices.filter((i) => i.status === 'DRAFT');
    if (drafts.length > 0) {
      items.push({
        tone: 'warn',
        label: `${drafts.length} relevé(s) client en brouillon`,
        detail: 'À approuver puis envoyer',
        href: '/invoices',
      });
    }
    for (const inv of incomingInvoices) {
      if (
        inv.status !== 'DISPUTED' &&
        inv.status !== 'FLAGGED' &&
        Number(inv.varianceGross ?? 0) > 0
      ) {
        items.push({
          tone: 'info',
          label: `Écart à vérifier — ${inv.carrier?.name ?? 'transporteur'}`,
          detail: `Variance ${money(inv.varianceGross, inv.currency)}`,
          href: '/billing/freight-audit',
        });
      }
    }
    return items.slice(0, 6);
  });

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

  $effect(() => {
    void load();
  });
</script>

<PageHeader
  title="Finance Cockpit"
  eyebrow="Finance"
  subtitle="Récupérez de l’argent : économies d’audit, litiges, AR/AP et cash — avec votre analyste financier IA."
/>

{#if error}<ErrorNotice message={error} />{/if}

<section class="mb-5 rounded-card border border-edge bg-surface p-4 shadow-sm">
  <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
    <div>
      <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Finance ops</p>
      <h1 class="mt-1 text-xl font-bold text-ink">Cash control</h1>
    </div>
    <div class="flex flex-wrap gap-2">
      <a
        href="/invoices"
        class="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-white hover:bg-accent-strong"
        >Factures</a
      >
      <a
        href="/billing/freight-audit"
        class="rounded-md border border-edge px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-muted"
        >Audit</a
      >
      <a
        href="/integrations"
        class="rounded-md border border-edge px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-surface-muted"
        >Compta sync</a
      >
    </div>
  </div>
  <div class="mt-4 grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
    <div class="rounded-xl bg-surface-muted p-3">
      <p class="text-xs text-ink-faint">AR</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{loading ? '—' : receivableTotal}</p>
    </div>
    <div class="rounded-xl bg-surface-muted p-3">
      <p class="text-xs text-ink-faint">AP</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{loading ? '—' : payableTotal}</p>
    </div>
    <div class="rounded-xl bg-surface-muted p-3">
      <p class="text-xs text-ink-faint">Litiges</p>
      <p class="mt-1 text-2xl font-semibold text-ink">{loading ? '—' : disputedCount}</p>
    </div>
    <div class="rounded-xl bg-surface-muted p-3">
      <p class="text-xs text-ink-faint">Recovered 30j</p>
      <p class="mt-1 text-2xl font-semibold text-ink">
        {loading ? '—' : Number(savings?.tenantTotal ?? 0).toLocaleString()}
      </p>
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
      <div
        class="mt-4 flex items-center justify-between rounded-inner bg-surface-muted p-3 text-sm"
      >
        <span class="text-ink-muted">Payées</span><span class="font-semibold text-ink"
          >{paidReceivables}</span
        >
      </div>
      <a href="/invoices" class="mt-4 inline-flex text-sm font-semibold text-accent hover:underline"
        >Ouvrir les factures →</a
      >
    </Card>

    <Card>
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Payables</p>
          <h2 class="mt-1 text-lg font-bold text-ink">Vendor / carrier invoices</h2>
        </div>
        <Badge tone={carrierInvoices.some((i) => i.status === 'DISPUTED') ? 'danger' : 'neutral'}
          >{carrierInvoices.length}</Badge
        >
      </div>
      <div
        class="mt-4 flex items-center justify-between rounded-inner bg-surface-muted p-3 text-sm"
      >
        <span class="text-ink-muted">Total attendu</span><span class="font-semibold text-ink"
          >{payableTotal}</span
        >
      </div>
      <a href="/invoices" class="mt-4 inline-flex text-sm font-semibold text-accent hover:underline"
        >Voir AP / carrier →</a
      >
    </Card>

    <Card>
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Audit</p>
          <h2 class="mt-1 text-lg font-bold text-ink">Freight audit agent lane</h2>
        </div>
        <Badge tone={disputedCount ? 'danger' : 'ok'}>{disputedCount} flagged</Badge>
      </div>
      <div
        class="mt-4 flex items-center justify-between rounded-inner bg-surface-muted p-3 text-sm"
      >
        <span class="text-ink-muted">Variance brute</span><span class="font-semibold text-ink"
          >{auditRisk}</span
        >
      </div>
      <a
        href="/billing/freight-audit"
        class="mt-4 inline-flex text-sm font-semibold text-accent hover:underline"
        >Ouvrir l’audit →</a
      >
    </Card>
  </div>
{/if}

<div class="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
  <Card padded={false}>
    <div class="flex items-center justify-between border-b border-edge-soft px-4 py-3">
      <h2 class="text-base font-bold text-ink">À traiter</h2>
      <Badge
        tone={worklist.some((w) => w.tone === 'danger')
          ? 'danger'
          : worklist.length
            ? 'warn'
            : 'ok'}
      >
        {worklist.length}
      </Badge>
    </div>
    {#if worklist.length === 0}
      <EmptyState
        message="Rien en attente : litiges résolus, brouillons envoyés et écarts traités."
      />
    {:else}
      <div class="divide-y divide-edge-soft">
        {#each worklist as item (item.label + item.detail)}
          <a
            href={item.href}
            class="flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-surface-muted"
          >
            <Badge tone={item.tone}
              >{item.tone === 'danger'
                ? 'Litige'
                : item.tone === 'warn'
                  ? 'Action'
                  : 'Écart'}</Badge
            >
            <span class="font-medium text-ink">{item.label}</span>
            <span class="ml-auto text-ink-muted">{item.detail}</span>
          </a>
        {/each}
      </div>
    {/if}
  </Card>

  <div class="h-[520px]">
    <AgentPanel
      presetId="finance-analyst"
      title="Analyste financier IA"
      intro="Demandez une synthèse des écarts, l’état des litiges ou une relance — l’agent propose, vous approuvez."
    />
  </div>
</div>

{#if !loading && !carrierInvoices.length && !customerInvoices.length && !incomingInvoices.length}
  <div class="mt-5">
    <Card>
      <EmptyState
        title="Aucune facture pour l’instant"
        message="Les relevés client se génèrent depuis les ordres livrés, et les factures transporteur arrivent via l’audit. Livrez un ordre ou importez une facture pour démarrer."
      >
        {#snippet children()}
          <a
            href="/billing/freight-audit"
            class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-strong"
            >Ouvrir l’audit transporteur</a
          >
        {/snippet}
      </EmptyState>
    </Card>
  </div>
{/if}
