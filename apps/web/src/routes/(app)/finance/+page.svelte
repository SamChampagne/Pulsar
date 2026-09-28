<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  const canCarrier = $derived(!!$auth?.user.permissions.includes('billing.invoices.read'));
  const canCustomer = $derived(
    !!$auth?.user.permissions.includes('billing.customer-invoices.read'),
  );
  const canAudit = $derived(!!$auth?.user.permissions.includes('billing.freight-audit.read'));
  const canSupplier = $derived(
    !!$auth?.user.permissions.includes('billing.supplier-invoices.read'),
  );
  const canLegacy = $derived(canCarrier || canCustomer || canAudit);
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorNotice,
    PageHeader,
    Skeleton,
  } from '$lib/components/ui';

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

  let carrierInvoices = $state<CarrierInvoice[]>([]);
  let customerInvoices = $state<CustomerInvoice[]>([]);
  let incomingInvoices = $state<IncomingInvoice[]>([]);
  let loading = $state(true);
  let error = $state('');

  const disputedCount = $derived(
    [
      ...carrierInvoices.filter((i) => i.status === 'DISPUTED'),
      ...incomingInvoices.filter((i) => i.status === 'DISPUTED' || i.status === 'FLAGGED'),
    ].length,
  );
  const draftReceivables = $derived(customerInvoices.filter((i) => i.status === 'DRAFT').length);
  const paidReceivables = $derived(customerInvoices.filter((i) => i.status === 'PAID').length);

  function money(value: string | null, currency: string): string {
    return `${Number(value ?? 0).toLocaleString('fr-CA', { maximumFractionDigits: 2 })} ${currency}`;
  }

  interface WorkItem {
    id: string;
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
          id: 'incoming:' + inv.id,
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
          id: 'carrier:' + inv.id,
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
        id: 'drafts',
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
          id: 'variance:' + inv.id,
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
      const [carrier, customer, incoming] = await Promise.all([
        canCarrier ? api<CarrierInvoice[]>('/billing/invoices') : Promise.resolve([]),
        canCustomer ? api<CustomerInvoice[]>('/billing/customer-invoices') : Promise.resolve([]),
        canAudit ? api<IncomingInvoice[]>('/freight-audit/incoming-invoices') : Promise.resolve([]),
      ]);
      carrierInvoices = carrier;
      customerInvoices = customer;
      incomingInvoices = incoming;
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

<svelte:head><title>Finance · Pulsar</title></svelte:head>
<PageHeader
  title="Finance"
  subtitle="Facturation clients, paiements fournisseurs et écarts à traiter."
>
  {#snippet actions()}
    {#if canAudit}<Button variant="secondary" href="/billing/freight-audit"
        >Audit transporteur</Button
      >{/if}
    {#if canCarrier || canCustomer}<Button href="/invoices">Clients et transporteurs</Button>{/if}
  {/snippet}
</PageHeader>
{#if $auth?.user.permissions.includes('billing.ledger.read')}
  <div class="mb-5 flex flex-wrap gap-2">
    <Button variant="secondary" href="/billing/accounting-profile">Profil comptable</Button><Button
      variant="secondary"
      href="/billing/budgets">Budgets par devise</Button
    >
  </div>
{/if}
{#if canSupplier}
  <section
    class="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-edge bg-surface p-4"
    aria-label="Registre fournisseur"
  >
    <div class="min-w-0">
      <h2 class="font-semibold">Factures fournisseur reçues</h2>
      <p class="mt-1 max-w-2xl text-sm text-ink-muted">
        Saisie, justificatifs et qualification documentaire. Fonctionne avec Finance seul. Ce
        registre n’est pas encore comptabilisé dans les dettes ou les paiements.
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button href="/billing/supplier-invoices">Ouvrir le registre fournisseur</Button><Button
        href="/billing/suppliers"
        variant="secondary">Dossiers fournisseur</Button
      >
      <Button href="/billing/supplier-schedules" variant="secondary">Échéancier fournisseur</Button>
    </div>
  </section>
{/if}
<ErrorNotice message={error} onretry={load} />
{#if loading}
  <Skeleton rows={6} />
{:else if !error && canLegacy}
  <div class="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Situation de la facturation">
    {#each [{ visible: canCustomer, label: 'Brouillons clients', value: draftReceivables, href: '/invoices' }, { visible: canCarrier || canAudit, label: 'Litiges et alertes', value: disputedCount, href: canAudit ? '/billing/freight-audit' : '/invoices' }, { visible: canCarrier, label: 'Factures transporteurs', value: carrierInvoices.length, href: '/invoices' }, { visible: canCustomer, label: 'Factures clients payées', value: paidReceivables, href: '/invoices' }].filter((m) => m.visible) as metric}
      <a
        href={metric.href}
        class="rounded-lg border border-edge bg-surface p-4 transition-colors hover:bg-surface-muted"
      >
        <span class="text-xs text-ink-muted">{metric.label}</span>
        <span class="mt-1 block text-2xl font-semibold tabular-nums">{metric.value}</span>
      </a>
    {/each}
  </div>

  <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
    <Card padded={false}>
      <div class="flex items-center justify-between border-b border-edge px-4 py-3">
        <h2 class="text-sm font-semibold">À traiter en priorité</h2>
        <Badge tone={worklist.length ? 'warn' : 'neutral'}>{worklist.length}</Badge>
      </div>
      {#if !carrierInvoices.length && !customerInvoices.length && !incomingInvoices.length}
        <EmptyState
          title="Votre facturation commence ici"
          message="Générez un relevé depuis un ordre livré ou importez une facture transporteur pour lancer son audit."
        >
          {#snippet children()}{#if canAudit}<Button
                href="/billing/freight-audit"
                variant="secondary">Importer une facture</Button
              >{/if}{/snippet}
        </EmptyState>
      {:else if worklist.length === 0}
        <p class="px-4 py-8 text-sm text-ink-muted">
          Aucun brouillon, litige ou écart à traiter dans les factures chargées.
        </p>
      {:else}
        <div class="divide-y divide-edge-soft">
          {#each worklist as item (item.id)}
            <a
              href={item.href}
              class="flex flex-wrap items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-surface-muted"
            >
              <Badge tone={item.tone}
                >{item.tone === 'danger'
                  ? 'Litige'
                  : item.tone === 'warn'
                    ? 'Action'
                    : 'Écart'}</Badge
              >
              <span class="min-w-0 flex-1 font-medium">{item.label}</span>
              <span class="text-xs text-ink-muted">{item.detail}</span>
            </a>
          {/each}
        </div>
      {/if}
    </Card>
    <section
      class="rounded-lg border border-edge bg-surface"
      aria-label="Accès aux dossiers financiers"
    >
      <h2 class="border-b border-edge px-4 py-3 text-sm font-semibold">Dossiers financiers</h2>
      {#each [{ visible: canCustomer, label: 'Factures clients', detail: customerInvoices.length + ' factures', href: '/invoices' }, { visible: canCarrier, label: 'Factures transporteurs', detail: carrierInvoices.length + ' factures', href: '/invoices' }, { visible: canAudit, label: 'Audit transporteur', detail: incomingInvoices.length + ' factures importées', href: '/billing/freight-audit' }].filter((s) => s.visible) as section}
        <a
          href={section.href}
          class="flex items-center justify-between gap-2 border-b border-edge-soft px-4 py-3 text-sm last:border-0 hover:bg-surface-muted"
        >
          <span
            ><span class="block font-medium">{section.label}</span><span
              class="mt-1 block text-xs text-ink-muted">{section.detail}</span
            ></span
          >
          <span aria-hidden="true" class="text-ink-muted">→</span>
        </a>
      {/each}
    </section>
  </div>
{/if}
