<script lang="ts">
  import { onDestroy } from 'svelte';
  import { PERMISSIONS, type Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { confirmAction } from '$lib/stores/confirmation';
  import { formatMoney } from '$lib/format';
  import { paymentStatusLabel, paymentStatusTone, type Payment } from './payments';
  import {
    Card,
    Button,
    Badge,
    Drawer,
    Field,
    Input,
    Skeleton,
    ErrorNotice,
  } from '$lib/components/ui';

  let { auditId, auditStatus }: { auditId: string; auditStatus: string } = $props();
  interface AccountingInvoice {
    id: string;
    invoiceNumber: string;
    carrierId: string;
    currency: string;
    status: string;
    totalAmount: string;
    taxAmount: string;
    amountPaid: string;
    reason?: string | null;
  }
  interface Flow {
    invoice: AccountingInvoice | null;
    candidates: Paginated<AccountingInvoice>;
    payments: (Pick<Payment, 'id' | 'paymentNumber' | 'status' | 'currency' | 'reconciledAt'> & {
      allocations: { amount: string }[];
      bankTransaction: { id: string; bankAccountId: string } | null;
    })[];
  }
  const canRead = $derived(
    [
      PERMISSIONS.BILLING.FREIGHT_AUDIT_READ,
      PERMISSIONS.BILLING.INVOICES_READ,
      PERMISSIONS.BILLING.PAYMENTS_READ,
      PERMISSIONS.BILLING.LEDGER_READ,
    ].every((p) => $auth?.user.permissions.includes(p)),
  );
  const canLink = $derived(
    !!$auth?.user.permissions.includes(PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE),
  );
  const canPay = $derived(!!$auth?.user.permissions.includes(PERMISSIONS.BILLING.PAYMENTS_MANAGE));
  let flow = $state<Flow | null>(null);
  let loading = $state(false),
    error = $state(''),
    linkError = $state(''),
    busy = $state(false);
  let open = $state(false),
    search = $state(''),
    candidatePage = $state(1);
  let generation = 0;
  async function load(id: string, pageNumber = 1, term = '') {
    const request = ++generation;
    loading = true;
    error = '';
    try {
      const result = await api<Flow>(
        `/freight-audit/incoming-invoices/${encodeURIComponent(id)}/accounting`,
        { query: { page: pageNumber, pageSize: 10, search: term } },
      );
      if (request === generation && id === auditId) {
        flow = result;
        candidatePage = pageNumber;
      }
    } catch (e) {
      if (request === generation)
        error = e instanceof ApiError ? e.message : 'Dossier financier indisponible.';
    } finally {
      if (request === generation) loading = false;
    }
  }
  $effect(() => {
    const id = auditId;
    void auditStatus;
    flow = null;
    open = false;
    search = '';
    candidatePage = 1;
    linkError = '';
    if (canRead) void load(id);
    else {
      generation++;
      loading = false;
    }
  });
  onDestroy(() => {
    generation++;
  });
  async function link(invoice: AccountingInvoice) {
    if (busy || !canLink || invoice.reason) return;
    busy = true;
    linkError = '';
    const id = auditId;
    try {
      if (
        !(await confirmAction(
          `Associer ${invoice.invoiceNumber} à cet audit ? Cette association est durable et ne crée ni facture, ni paiement, ni écriture.`,
          { title: 'Associer la facture comptable ?', confirmLabel: 'Associer', dangerous: false },
        )) ||
        id !== auditId
      )
        return;
      await api(`/freight-audit/incoming-invoices/${encodeURIComponent(id)}/link-invoice`, {
        method: 'POST',
        body: { invoiceId: invoice.id },
      });
      if (id === auditId) {
        open = false;
        await load(id);
      }
    } catch (e) {
      if (id === auditId)
        linkError =
          e instanceof ApiError
            ? e.message
            : 'Association non confirmée. Actualisez avant de réessayer.';
    } finally {
      busy = false;
    }
  }
</script>

<Card>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 class="text-sm font-semibold">Dossier financier</h2>
      <p class="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">
        Audit → facture comptable → paiements → banque. Chaque étape conserve son propre statut.
      </p>
    </div>
    {#if canRead}<Button variant="ghost" disabled={busy || loading} onclick={() => load(auditId)}
        >Actualiser le dossier</Button
      >{/if}
  </div>
  {#if !canRead}
    <p class="mt-4 text-sm text-ink-muted">
      La vue complète nécessite les droits de lecture des audits, factures, paiements et du grand
      livre.
    </p>
  {:else if loading && !open}<div class="mt-4"><Skeleton rows={3} /></div>
  {:else if error && !open}<div class="mt-4">
      <ErrorNotice message={error} onretry={() => load(auditId)} />
    </div>
  {:else if flow?.invoice}
    {@const invoice = flow.invoice}
    <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-4">
      <div>
        <a
          class="font-mono text-sm font-semibold text-accent hover:underline"
          href={`/invoices?invoice=${encodeURIComponent(invoice.id)}`}>{invoice.invoiceNumber}</a
        >
        <p class="mt-1 text-xs text-ink-muted">
          {formatMoney(invoice.totalAmount, invoice.currency)} TTC · {formatMoney(
            invoice.amountPaid,
            invoice.currency,
          )} comptabilisé en paiement
        </p>
      </div>
      {#if canPay && invoice.status === 'APPROVED' && Number(invoice.totalAmount) > Number(invoice.amountPaid)}<Button
          variant="secondary"
          href={`/billing/payments/new?partyType=CARRIER&party=${encodeURIComponent(invoice.carrierId)}&target=${encodeURIComponent(invoice.id)}`}
          >Préparer le paiement</Button
        >{/if}
    </div>
    <ol aria-label="Paiements liés" class="mt-4 divide-y divide-edge">
      {#each flow.payments as payment (payment.id)}
        <li class="flex flex-wrap items-center justify-between gap-3 py-3">
          <div>
            <a
              class="font-mono text-sm text-accent hover:underline"
              href={`/billing/payments/${encodeURIComponent(payment.id)}`}
              >{payment.paymentNumber}</a
            >
            <p class="mt-1 text-xs text-ink-muted">
              {formatMoney(
                payment.allocations.reduce((sum, a) => sum + Number(a.amount), 0),
                payment.currency,
              )} alloué à cette facture
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Badge tone={paymentStatusTone[payment.status]}
              >{paymentStatusLabel[payment.status]}</Badge
            >
            {#if payment.status === 'SUBMITTED'}<a
                class="text-xs text-accent hover:underline"
                href={`/billing/banking?payment=${encodeURIComponent(payment.id)}`}
                >{payment.bankTransaction ? 'Banque rapprochée' : 'À rapprocher en banque'}</a
              >{/if}
          </div>
        </li>
      {:else}<li class="py-3 text-sm text-ink-muted">
          Aucun paiement lié. Préparez un brouillon depuis la facture approuvée.
        </li>{/each}
    </ol>
  {:else if flow}
    <p class="mt-4 text-sm text-ink-muted">
      Aucune facture comptable associée. Choisissez une facture approuvée du même transporteur, de
      même devise, couvrant exactement les mêmes chargements et le montant hors taxes retenu.
    </p>
    <div class="mt-3 flex flex-wrap gap-2">
      {#if canLink}<Button
          variant="secondary"
          disabled={!['MATCHED', 'RESOLVED', 'PAID'].includes(auditStatus)}
          onclick={() => {
            linkError = '';
            open = true;
          }}>Associer une facture existante</Button
        >{/if}
      <Button variant="ghost" href="/invoices">Ouvrir les factures</Button>
    </div>
    {#if !['MATCHED', 'RESOLVED', 'PAID'].includes(auditStatus)}<p
        class="mt-2 text-xs text-ink-muted"
      >
        Terminez le rapprochement et les litiges avant association.
      </p>{/if}
  {/if}
</Card>

<Drawer bind:open title="Associer une facture comptable" width="lg" dismissible={!busy}>
  <p class="mb-4 text-sm leading-relaxed text-ink-muted">
    L’association ne modifie pas les montants. Les taxes restent celles de la facture comptable. Une
    facture ne peut être associée qu’à un seul audit.
  </p>
  <form
    class="mb-4 flex items-end gap-2"
    onsubmit={(e) => {
      e.preventDefault();
      void load(auditId, 1, search);
    }}
  >
    <div class="min-w-0 flex-1">
      <Field label="Numéro de facture"
        ><Input bind:value={search} disabled={busy || loading} /></Field
      >
    </div>
    <Button type="submit" variant="secondary" disabled={busy || loading}>Rechercher</Button>
  </form>
  <ErrorNotice message={linkError || error} />
  {#if loading}<Skeleton rows={4} />{:else if !error}
    <ul class="divide-y divide-edge">
      {#each flow?.candidates.items ?? [] as invoice (invoice.id)}
        <li class="py-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="font-mono text-sm font-medium">{invoice.invoiceNumber}</p>
              <p class="mt-1 text-xs text-ink-muted">
                {formatMoney(
                  Number(invoice.totalAmount) - Number(invoice.taxAmount),
                  invoice.currency,
                )} hors taxes
              </p>
            </div>
            <Button
              variant="secondary"
              disabled={busy || !!invoice.reason}
              onclick={() => link(invoice)}>Associer {invoice.invoiceNumber}</Button
            >
          </div>
          {#if invoice.reason}<p class="mt-2 text-xs text-warn">{invoice.reason}</p>{/if}
        </li>
      {:else}<li class="py-4 text-sm text-ink-muted">
          Aucune facture approuvée disponible pour ce transporteur et cette devise. Vérifiez les
          factures existantes avant d’en créer une.
        </li>{/each}
    </ul>
  {/if}
  {#snippet footer()}
    <Button
      variant="secondary"
      disabled={busy || loading || candidatePage <= 1}
      onclick={() => load(auditId, candidatePage - 1, search)}>Précédent</Button
    >
    <span class="text-xs text-ink-muted">Page {candidatePage}</span>
    <Button
      variant="secondary"
      disabled={busy || loading || candidatePage * 10 >= (flow?.candidates.total ?? 0)}
      onclick={() => load(auditId, candidatePage + 1, search)}>Suivant</Button
    >
  {/snippet}
</Drawer>
