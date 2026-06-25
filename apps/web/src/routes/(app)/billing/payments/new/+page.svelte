<script lang="ts">
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatMoney } from '$lib/format';
  import {
    PageHeader,
    Button,
    Card,
    Badge,
    type Tone,
  } from '$lib/components/ui';

  // ── Types ─────────────────────────────────────────────────────────────────────

  type PaymentType = 'RECEIVE' | 'PAY';

  interface OpenInvoice {
    id: string;
    invoiceNumber: string;
    totalAmount: string | number;
    amountPaid: string | number;
    currency: string;
    targetType: string;
    outstanding: string | number;
  }

  interface ModeOfPayment {
    id: string;
    name: string;
    accountCode: string;
    isDefault: boolean;
  }

  interface PartyOption {
    id: string;
    name: string;
  }

  interface AllocationInput {
    invoice: OpenInvoice;
    amount: number;
  }

  // ── State ─────────────────────────────────────────────────────────────────────

  let type = $state<PaymentType>('RECEIVE');
  let partyId = $state('');
  let modeOfPaymentId = $state('');
  let date = $state(new Date().toISOString().slice(0, 10));
  let currency = $state('CAD');
  let totalAmountOverride = $state<number | null>(null);
  let reference = $state('');
  let note = $state('');

  let customers = $state<PartyOption[]>([]);
  let carriers = $state<PartyOption[]>([]);
  let modes = $state<ModeOfPayment[]>([]);
  let openInvoices = $state<OpenInvoice[]>([]);
  let allocations = $state<AllocationInput[]>([]);

  let loadingParties = $state(false);
  let loadingInvoices = $state(false);
  let loadingModes = $state(false);
  let submitting = $state(false);
  let validationError = $state('');

  // ── Derived ───────────────────────────────────────────────────────────────────

  const parties = $derived(type === 'RECEIVE' ? customers : carriers);

  const partyType = $derived(type === 'RECEIVE' ? 'CUSTOMER' : 'CARRIER');

  const totalAllocated = $derived(
    allocations.reduce((sum, a) => sum + (a.amount || 0), 0),
  );

  const totalAmount = $derived(
    totalAmountOverride !== null ? totalAmountOverride : totalAllocated,
  );

  const reste = $derived(totalAmount - totalAllocated);

  // ── Data loading ─────────────────────────────────────────────────────────────

  async function loadCustomers() {
    if (customers.length > 0) return;
    loadingParties = true;
    try {
      const res = await api<{ items: PartyOption[] }>('/transportation/customers', {
        query: { pageSize: 200 },
      });
      customers = res.items;
    } catch {
      // non-blocking
    } finally {
      loadingParties = false;
    }
  }

  async function loadCarriers() {
    if (carriers.length > 0) return;
    loadingParties = true;
    try {
      const res = await api<{ items: PartyOption[] }>('/transportation/carriers', {
        query: { pageSize: 200 },
      });
      carriers = res.items;
    } catch {
      // non-blocking
    } finally {
      loadingParties = false;
    }
  }

  async function loadModes() {
    if (modes.length > 0) return;
    loadingModes = true;
    try {
      const res = await api<ModeOfPayment[]>('/billing/modes-of-payment');
      modes = res;
      const def = modes.find((m) => m.isDefault);
      if (def && !modeOfPaymentId) modeOfPaymentId = def.id;
    } catch {
      // non-blocking
    } finally {
      loadingModes = false;
    }
  }

  async function loadOpenInvoices() {
    if (!partyId) { openInvoices = []; allocations = []; return; }
    loadingInvoices = true;
    openInvoices = [];
    allocations = [];
    try {
      const res = await api<OpenInvoice[]>('/billing/payments/open-invoices', {
        query: { partyType, partyId },
      });
      openInvoices = res;
      allocations = res.map((inv) => ({
        invoice: inv,
        amount: Number(inv.outstanding),
      }));
      if (allocations.length > 0) {
        currency = allocations[0].invoice.currency;
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Impossible de charger les factures ouvertes');
    } finally {
      loadingInvoices = false;
    }
  }

  // ── Effects ───────────────────────────────────────────────────────────────────

  $effect(() => {
    if (type === 'RECEIVE') {
      void loadCustomers();
    } else {
      void loadCarriers();
    }
    partyId = '';
    openInvoices = [];
    allocations = [];
    void loadModes();
  });

  $effect(() => {
    void partyId;
    void loadOpenInvoices();
  });

  // ── Clamp allocation ──────────────────────────────────────────────────────────

  function clampAmount(idx: number) {
    const outstanding = Number(allocations[idx].invoice.outstanding);
    if (allocations[idx].amount < 0) allocations[idx].amount = 0;
    if (allocations[idx].amount > outstanding) allocations[idx].amount = outstanding;
  }

  // ── Submit ────────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    validationError = '';

    // Client-side validation
    const nonZero = allocations.filter((a) => a.amount > 0);
    if (nonZero.length === 0) {
      validationError = 'Au moins une allocation doit être supérieure à 0.';
      return;
    }
    for (const a of allocations) {
      if (a.amount > Number(a.invoice.outstanding)) {
        validationError = `L'allocation pour ${a.invoice.invoiceNumber} dépasse le montant dû.`;
        return;
      }
    }
    if (totalAllocated > totalAmount) {
      validationError = 'Le total alloué ne peut pas dépasser le montant du paiement.';
      return;
    }
    if (!partyId) {
      validationError = 'Veuillez sélectionner une partie.';
      return;
    }
    if (!modeOfPaymentId) {
      validationError = 'Veuillez sélectionner un mode de paiement.';
      return;
    }

    submitting = true;
    try {
      const body = {
        type,
        partyType,
        partyId,
        modeOfPaymentId,
        date: new Date(date).toISOString(),
        currency,
        totalAmount,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        allocations: nonZero.map((a) => ({
          targetType: a.invoice.targetType,
          targetId: a.invoice.id,
          amount: a.amount,
        })),
      };

      const payment = await api<{ id: string }>('/billing/payments', {
        method: 'POST',
        body,
      });

      await api(`/billing/payments/${payment.id}/submit`, { method: 'POST' });
      toast.success('Paiement créé et soumis avec succès.');
      goto(`/billing/payments/${payment.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erreur lors de la création du paiement');
    } finally {
      submitting = false;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function typeTone(t: PaymentType): Tone {
    return t === 'RECEIVE' ? 'ok' : 'info';
  }
</script>

<PageHeader
  title="Nouvelle écriture de paiement"
  subtitle="Créez un paiement et allouez-le aux factures ouvertes."
>
  {#snippet actions()}
    <Button variant="secondary" onclick={() => goto('/billing/payments')}>← Retour</Button>
  {/snippet}
</PageHeader>

<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
  <!-- ── Main form ── -->
  <div class="space-y-6 lg:col-span-2">

    <!-- Type + Party -->
    <Card>
      <h2 class="mb-4 text-sm font-semibold text-ink">Type et partie</h2>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <!-- Type -->
        <div>
          <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Type de paiement
          </label>
          <div class="flex gap-2">
            {#each (['RECEIVE', 'PAY'] as PaymentType[]) as t (t)}
              <button
                type="button"
                class={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors
                  ${type === t
                    ? 'border-accent bg-accent text-white'
                    : 'border-edge bg-surface text-ink-muted hover:border-accent hover:text-ink'}`}
                onclick={() => { type = t; }}
              >
                {t === 'RECEIVE' ? 'Encaissement' : 'Décaissement'}
              </button>
            {/each}
          </div>
        </div>

        <!-- Party -->
        <div>
          <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            {type === 'RECEIVE' ? 'Client' : 'Transporteur'}
          </label>
          {#if loadingParties}
            <div class="text-xs text-ink-faint">Chargement…</div>
          {:else}
            <select
              bind:value={partyId}
              class="w-full rounded-md border border-edge bg-surface px-3 py-2 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">— Sélectionner —</option>
              {#each parties as p (p.id)}
                <option value={p.id}>{p.name}</option>
              {/each}
            </select>
          {/if}
        </div>
      </div>
    </Card>

    <!-- Allocations table -->
    {#if partyId}
      <Card>
        <h2 class="mb-3 text-sm font-semibold text-ink">Allocations aux factures ouvertes</h2>
        {#if loadingInvoices}
          <div class="py-4 text-center text-xs text-ink-faint">Chargement des factures…</div>
        {:else if openInvoices.length === 0}
          <div class="rounded-md border border-edge bg-surface-muted/40 px-4 py-3 text-xs text-ink-muted">
            Aucune facture ouverte pour cette partie.
          </div>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-edge text-[11px] uppercase tracking-wide text-ink-muted">
                  <th class="py-2 pr-3 text-left font-semibold">N° facture</th>
                  <th class="py-2 px-2 text-right font-semibold w-28">Total</th>
                  <th class="py-2 px-2 text-right font-semibold w-28">Restant dû</th>
                  <th class="py-2 pl-3 text-right font-semibold w-32">Montant alloué</th>
                </tr>
              </thead>
              <tbody>
                {#each allocations as alloc, idx (alloc.invoice.id)}
                  <tr class="border-b border-edge/50 last:border-0">
                    <td class="py-2 pr-3 font-mono text-sm font-semibold text-ink">
                      {alloc.invoice.invoiceNumber}
                      <span class="ml-1 text-[10px] text-ink-faint">{alloc.invoice.targetType}</span>
                    </td>
                    <td class="py-2 px-2 text-right text-ink-muted">
                      {formatMoney(alloc.invoice.totalAmount, alloc.invoice.currency)}
                    </td>
                    <td class="py-2 px-2 text-right text-warn font-semibold">
                      {formatMoney(alloc.invoice.outstanding, alloc.invoice.currency)}
                    </td>
                    <td class="py-2 pl-3 text-right">
                      <input
                        type="number"
                        min="0"
                        max={Number(alloc.invoice.outstanding)}
                        step="0.01"
                        bind:value={alloc.amount}
                        onblur={() => clampAmount(idx)}
                        class="w-28 rounded-md border border-edge bg-surface px-2 py-1 text-right text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </td>
                  </tr>
                {/each}
              </tbody>
              <tfoot>
                <tr class="border-t-2 border-edge">
                  <td colspan="2" class="py-2 pr-3 text-right text-[11px] uppercase tracking-wide font-semibold text-ink-muted">
                    Total alloué
                  </td>
                  <td colspan="2" class="py-2 pl-3 text-right text-sm font-bold text-accent">
                    {formatMoney(totalAllocated, currency)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        {/if}
      </Card>
    {/if}

  </div>

  <!-- ── Right sidebar ── -->
  <div class="space-y-6">

    <!-- Payment details -->
    <Card>
      <h2 class="mb-4 text-sm font-semibold text-ink">Détails du paiement</h2>
      <div class="space-y-3">

        <!-- Mode of payment -->
        <div>
          <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Mode de paiement
          </label>
          {#if loadingModes}
            <div class="text-xs text-ink-faint">Chargement…</div>
          {:else}
            <select
              bind:value={modeOfPaymentId}
              class="w-full rounded-md border border-edge bg-surface px-3 py-2 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">— Sélectionner —</option>
              {#each modes as m (m.id)}
                <option value={m.id}>{m.name}</option>
              {/each}
            </select>
          {/if}
        </div>

        <!-- Date -->
        <div>
          <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Date
          </label>
          <input
            type="date"
            bind:value={date}
            class="w-full rounded-md border border-edge bg-surface px-3 py-2 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <!-- Montant total (override) -->
        <div>
          <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Montant total
            <span class="ml-1 font-normal normal-case text-ink-faint">(auto = somme allocations)</span>
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder={String(totalAllocated.toFixed(2))}
            value={totalAmountOverride ?? ''}
            oninput={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              totalAmountOverride = v === '' ? null : Number(v);
            }}
            class="w-full rounded-md border border-edge bg-surface px-3 py-2 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <!-- Reference -->
        <div>
          <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Référence <span class="font-normal normal-case text-ink-faint">(optionnel)</span>
          </label>
          <input
            type="text"
            bind:value={reference}
            placeholder="Ex : CHQ-1234"
            class="w-full rounded-md border border-edge bg-surface px-3 py-2 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <!-- Note -->
        <div>
          <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Note <span class="font-normal normal-case text-ink-faint">(optionnel)</span>
          </label>
          <textarea
            bind:value={note}
            rows={2}
            placeholder="Note interne…"
            class="w-full rounded-md border border-edge bg-surface px-3 py-2 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent resize-none"
          ></textarea>
        </div>
      </div>
    </Card>

    <!-- Summary -->
    {#if partyId && openInvoices.length > 0}
      <Card>
        <h2 class="mb-3 text-sm font-semibold text-ink">Résumé</h2>
        <div class="space-y-2 text-xs">
          <div class="flex justify-between">
            <span class="text-ink-muted">Type</span>
            <Badge tone={typeTone(type)}>
              {type === 'RECEIVE' ? 'Encaissement' : 'Décaissement'}
            </Badge>
          </div>
          <div class="flex justify-between">
            <span class="text-ink-muted">Total alloué</span>
            <span class="font-semibold text-ink">{formatMoney(totalAllocated, currency)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-ink-muted">Montant paiement</span>
            <span class="font-semibold text-ink">{formatMoney(totalAmount, currency)}</span>
          </div>
          {#if reste !== 0}
            <div class="flex justify-between border-t border-edge pt-2">
              <span class="text-ink-muted">Reste non alloué</span>
              <span class={`font-semibold ${reste < 0 ? 'text-danger' : 'text-warn'}`}>
                {formatMoney(reste, currency)}
              </span>
            </div>
          {/if}
        </div>
      </Card>
    {/if}

    <!-- Validation error -->
    {#if validationError}
      <div class="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
        {validationError}
      </div>
    {/if}

    <!-- Submit -->
    <Button
      variant="primary"
      loading={submitting}
      onclick={() => void handleSubmit()}
    >
      Créer et soumettre le paiement
    </Button>
  </div>
</div>
