<script lang="ts">
  import { page } from '$app/state';
  import { onDestroy } from 'svelte';
  import { auth } from '$lib/stores/auth';
  import { bankMatchError, PERMISSIONS } from '@pulsar/shared';
  import { Modal, Tabs } from '$lib/components/ui';
  import { confirmAction } from '$lib/stores/confirmation';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Card,
    Table,
    Badge,
    Button,
    EmptyState,
    Skeleton,
    ErrorNotice,
    type Tone,
  } from '$lib/components/ui';

  // ── Local types aligned to API responses ────────────────────────────────────

  /** Returned by GET /billing/bank-accounts (accountNumber is masked) */
  interface BankAccount {
    id: string;
    name: string;
    accountNumber: string | null;
    glAccountCode: string;
    currency: string;
    isDefault: boolean;
    createdAt: string;
    updatedAt: string;
  }

  /** Returned by GET /billing/bank-accounts/:id/balance */
  interface AccountBalance {
    balance: number;
    txnCount: number;
  }

  /** Returned by GET /billing/bank-transactions */
  interface BankTransaction {
    id: string;
    bankAccountId: string;
    date: string;
    description: string;
    /** Decimal serialised as string by Prisma */
    amount: string;
    reference: string | null;
    status: 'UNRECONCILED' | 'RECONCILED';
    matchedPaymentId: string | null;
    createdAt: string;
  }

  /** ModeOfPayment nested in candidatePayments */
  interface ModeOfPayment {
    id: string;
    name: string;
    accountCode: string;
  }

  /** Returned inside reconciliation().candidatePayments — Payment with modeOfPayment included */
  interface CandidatePayment {
    id: string;
    paymentNumber: string;
    type: 'RECEIVE' | 'PAY';
    status: string;
    partyType: string;
    partyId: string;
    modeOfPaymentId: string;
    date: string;
    currency: string;
    /** Decimal serialised as string */
    totalAmount: string;
    allocatedAmount: number;
    reference: string | null;
    reconciledAt: string | null;
    modeOfPayment: ModeOfPayment;
  }

  /** Returned by GET /billing/bank-transactions/reconciliation */
  interface ReconciliationResult {
    unreconciledTransactions: BankTransaction[];
    candidatePayments: CandidatePayment[];
  }

  // ── Tabs ────────────────────────────────────────────────────────────────────

  let activeTab = $state('accounts');
  const canManage = $derived(!!$auth?.user.permissions.includes(PERMISSIONS.BILLING.LEDGER_MANAGE));
  const canReadPayments = $derived(
    !!$auth?.user.permissions.includes(PERMISSIONS.BILLING.PAYMENTS_READ),
  );
  let paymentContext = $state<CandidatePayment | null>(null);
  let contextError = $state('');
  let contextGeneration = 0,
    reconGeneration = 0,
    txnGeneration = 0;
  async function loadPaymentContext(id: string) {
    const request = ++contextGeneration;
    paymentContext = null;
    contextError = '';
    activeTab = 'reconciliation';
    try {
      const [payment, matched, availableAccounts] = await Promise.all([
        api<CandidatePayment>(`/billing/payments/${encodeURIComponent(id)}`),
        api<BankTransaction[]>('/billing/bank-transactions', { query: { paymentId: id } }),
        api<BankAccount[]>('/billing/bank-accounts'),
      ]);
      if (request !== contextGeneration) return;
      paymentContext = payment;
      const compatible = availableAccounts.filter(
        (a) =>
          a.currency === payment.currency && a.glAccountCode === payment.modeOfPayment?.accountCode,
      );
      reconAccountId =
        matched[0]?.bankAccountId ?? (compatible.length === 1 ? compatible[0].id : '');
    } catch (e) {
      if (request === contextGeneration)
        contextError = e instanceof ApiError ? e.message : 'Paiement source indisponible.';
    }
  }
  $effect(() => {
    const id = page.url.searchParams.get('payment');
    if (id && canReadPayments) void loadPaymentContext(id);
    else {
      contextGeneration++;
      paymentContext = null;
      contextError = '';
    }
  });
  onDestroy(() => {
    contextGeneration++;
    reconGeneration++;
    txnGeneration++;
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function money(val: string | number | null | undefined): string {
    if (val === null || val === undefined) return '—';
    const n = Number(val);
    if (isNaN(n)) return '—';
    return n.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function signedMoney(val: string | number | null | undefined): string {
    if (val === null || val === undefined) return '—';
    const n = Number(val);
    if (isNaN(n)) return '—';
    const formatted = Math.abs(n).toLocaleString('fr-CA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return n < 0 ? `−${formatted}` : formatted;
  }

  function signedTone(val: string | number | null | undefined): Tone {
    const n = Number(val);
    if (isNaN(n)) return 'neutral';
    return n < 0 ? 'danger' : 'ok';
  }

  function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString('fr-CA');
  }

  function txnStatusTone(status: 'UNRECONCILED' | 'RECONCILED'): Tone {
    return status === 'RECONCILED' ? 'ok' : 'warn';
  }

  function txnStatusLabel(status: 'UNRECONCILED' | 'RECONCILED'): string {
    return status === 'RECONCILED' ? 'Réconcilié' : 'Non réconcilié';
  }

  // ── ─── TAB: COMPTES ─────────────────────────────────────────────────────────

  let accounts = $state<BankAccount[]>([]);
  let loadingAccounts = $state(true);
  let errorAccounts = $state('');

  // Per-account balance cache
  let balances = $state<Record<string, AccountBalance>>({});
  let loadingBalance = $state<Record<string, boolean>>({});

  async function loadAccounts() {
    loadingAccounts = true;
    errorAccounts = '';
    try {
      accounts = await api<BankAccount[]>('/billing/bank-accounts');
      // Load balances AFTER the await (outside any $effect's synchronous tracking),
      // so the balance writes never re-trigger a reactive effect (avoids
      // effect_update_depth_exceeded).
      for (const a of accounts) void loadBalance(a.id);
    } catch (e) {
      errorAccounts = e instanceof ApiError ? e.message : 'Échec du chargement des comptes';
    } finally {
      loadingAccounts = false;
    }
  }

  async function loadBalance(accountId: string) {
    loadingBalance = { ...loadingBalance, [accountId]: true };
    try {
      const result = await api<AccountBalance>(`/billing/bank-accounts/${accountId}/balance`);
      balances = { ...balances, [accountId]: result };
    } catch {
      // Best-effort — silently leave balance undefined
    } finally {
      loadingBalance = { ...loadingBalance, [accountId]: false };
    }
  }

  // Account modal
  let showAccountModal = $state(false);
  let editingAccount = $state<BankAccount | null>(null);
  let accountForm = $state({
    name: '',
    accountNumber: '',
    glAccountCode: '1010',
    currency: 'CAD',
    isDefault: false,
  });
  let savingAccount = $state(false);
  let accountFormError = $state('');

  function openCreateAccount() {
    editingAccount = null;
    accountForm = {
      name: '',
      accountNumber: '',
      glAccountCode: '1010',
      currency: 'CAD',
      isDefault: false,
    };
    accountFormError = '';
    showAccountModal = true;
  }

  function openEditAccount(acct: BankAccount) {
    editingAccount = acct;
    accountForm = {
      name: acct.name,
      accountNumber: '',
      glAccountCode: acct.glAccountCode,
      currency: acct.currency,
      isDefault: acct.isDefault,
    };
    accountFormError = '';
    showAccountModal = true;
  }

  async function saveAccount() {
    if (savingAccount || !canManage) return;
    accountFormError = '';
    savingAccount = true;
    try {
      const body: Record<string, unknown> = {
        name: accountForm.name.trim(),
        glAccountCode: accountForm.glAccountCode.trim(),
        currency: accountForm.currency.trim(),
        isDefault: accountForm.isDefault,
      };
      if (accountForm.accountNumber.trim()) {
        body.accountNumber = accountForm.accountNumber.trim();
      }
      if (editingAccount) {
        await api(`/billing/bank-accounts/${editingAccount.id}`, { method: 'PATCH', body });
        toast.success('Compte mis à jour');
      } else {
        await api('/billing/bank-accounts', { method: 'POST', body });
        toast.success('Compte créé');
      }
      showAccountModal = false;
      await loadAccounts();
    } catch (e) {
      accountFormError = e instanceof ApiError ? e.message : "Échec de l'enregistrement";
    } finally {
      savingAccount = false;
    }
  }

  let deletingAccountId = $state<string | null>(null);

  async function deleteAccount(acct: BankAccount) {
    if (deletingAccountId || !canManage) return;
    if (!(await confirmAction(`Supprimer le compte « ${acct.name} » ?`))) return;
    deletingAccountId = acct.id;
    try {
      await api(`/billing/bank-accounts/${acct.id}`, { method: 'DELETE' });
      toast.success('Compte supprimé');
      await loadAccounts();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la suppression');
    } finally {
      deletingAccountId = null;
    }
  }

  // Load balances whenever accounts change
  $effect(() => {
    void loadAccounts();
  });

  // ── ─── TAB: TRANSACTIONS ────────────────────────────────────────────────────

  let selectedAccountId = $state('');
  let statusFilter = $state('');
  let transactions = $state<BankTransaction[]>([]);
  let loadingTxns = $state(false);
  let errorTxns = $state('');

  async function loadTransactions() {
    const accountId = selectedAccountId,
      filter = statusFilter,
      request = ++txnGeneration;
    transactions = [];
    errorTxns = '';
    loadingTxns = !!accountId;
    if (!accountId) return;
    try {
      const query: Record<string, string> = { bankAccountId: accountId };
      if (filter) query.status = filter;
      const result = await api<BankTransaction[]>('/billing/bank-transactions', { query });
      if (request === txnGeneration) transactions = result;
    } catch (e) {
      if (request === txnGeneration)
        errorTxns = e instanceof ApiError ? e.message : 'Échec du chargement des transactions';
    } finally {
      if (request === txnGeneration) loadingTxns = false;
    }
  }

  $effect(() => {
    void selectedAccountId;
    void statusFilter;
    if (activeTab === 'transactions') void loadTransactions();
  });

  // Manual create form
  let showTxnForm = $state(false);
  let txnForm = $state({ date: '', description: '', amount: null as number | null, reference: '' });
  let savingTxn = $state(false);
  let txnFormError = $state('');

  function resetTxnForm() {
    txnForm = { date: '', description: '', amount: null, reference: '' };
    txnFormError = '';
  }

  async function createTransaction() {
    if (savingTxn || importingCsv || !canManage) return;
    txnFormError = '';
    if (!selectedAccountId) {
      txnFormError = 'Sélectionnez un compte.';
      return;
    }
    if (!txnForm.date) {
      txnFormError = 'La date est requise.';
      return;
    }
    if (!txnForm.description.trim()) {
      txnFormError = 'La description est requise.';
      return;
    }
    const amt = Number(txnForm.amount ?? '');
    if (txnForm.amount === null || txnForm.amount === undefined || isNaN(amt)) {
      txnFormError = 'Montant invalide.';
      return;
    }

    savingTxn = true;
    try {
      await api('/billing/bank-transactions', {
        method: 'POST',
        body: {
          bankAccountId: selectedAccountId,
          date: txnForm.date,
          description: txnForm.description.trim(),
          amount: amt,
          ...(txnForm.reference.trim() ? { reference: txnForm.reference.trim() } : {}),
        },
      });
      toast.success('Transaction créée');
      showTxnForm = false;
      resetTxnForm();
      await loadTransactions();
    } catch (e) {
      txnFormError = e instanceof ApiError ? e.message : 'Échec de la création';
    } finally {
      savingTxn = false;
    }
  }

  // CSV import
  let csvText = $state('');
  let importingCsv = $state(false);
  let importResult = $state<{ imported: number; errors: string[] } | null>(null);
  let importError = $state('');

  async function importCsv() {
    if (importingCsv || savingTxn || !canManage) return;
    importError = '';
    importResult = null;
    if (!selectedAccountId) {
      importError = 'Sélectionnez un compte.';
      return;
    }
    if (!csvText.trim()) {
      importError = 'Le contenu CSV est vide.';
      return;
    }
    importingCsv = true;
    try {
      const result = await api<{ imported: number; errors: string[] }>(
        '/billing/bank-transactions/import',
        { method: 'POST', body: { bankAccountId: selectedAccountId, csv: csvText } },
      );
      importResult = result;
      if (result.imported > 0) {
        toast.success(`${result.imported} transaction(s) importée(s)`);
        csvText = '';
        await loadTransactions();
      }
    } catch (e) {
      importError = e instanceof ApiError ? e.message : "Échec de l'import";
    } finally {
      importingCsv = false;
    }
  }

  // ── ─── TAB: RAPPROCHEMENT ───────────────────────────────────────────────────

  let reconAccountId = $state('');
  let reconResult = $state<ReconciliationResult | null>(null);
  let reconciledTxns = $state<BankTransaction[]>([]);
  let loadingRecon = $state(false);
  let errorRecon = $state('');

  // Selection state
  let selectedTxnId = $state<string | null>(null);
  let selectedPaymentId = $state<string | null>(null);
  let matching = $state(false);
  let unmatchingId = $state<string | null>(null);

  async function loadReconciliation() {
    const accountId = reconAccountId,
      request = ++reconGeneration;
    reconResult = null;
    reconciledTxns = [];
    errorRecon = '';
    selectedTxnId = null;
    selectedPaymentId = null;
    loadingRecon = !!accountId;
    if (!accountId) return;
    try {
      const [result, reconciled] = await Promise.all([
        api<ReconciliationResult>('/billing/bank-transactions/reconciliation', {
          query: { bankAccountId: accountId },
        }),
        api<BankTransaction[]>('/billing/bank-transactions', {
          query: { bankAccountId: accountId, status: 'RECONCILED' },
        }),
      ]);
      if (request !== reconGeneration) return;
      reconResult = result;
      reconciledTxns = reconciled;
      const focusId = page.url.searchParams.get('payment');
      if (result.candidatePayments.some((p) => p.id === focusId)) selectedPaymentId = focusId;
    } catch (e) {
      if (request === reconGeneration)
        errorRecon = e instanceof ApiError ? e.message : 'Échec du chargement du rapprochement';
    } finally {
      if (request === reconGeneration) loadingRecon = false;
    }
  }
  $effect(() => {
    void reconAccountId;
    if (activeTab === 'reconciliation') void loadReconciliation();
    else {
      reconGeneration++;
      loadingRecon = false;
    }
  });
  const selectedTxn = $derived(
    reconResult?.unreconciledTransactions.find((t) => t.id === selectedTxnId),
  );
  const selectedPayment = $derived(
    reconResult?.candidatePayments.find((p) => p.id === selectedPaymentId),
  );
  const reconAccount = $derived(accounts.find((a) => a.id === reconAccountId));
  const mismatch = $derived(
    selectedTxn && selectedPayment && reconAccount
      ? bankMatchError({
          transactionAmount: Number(selectedTxn.amount),
          paymentAmount: Number(selectedPayment.totalAmount),
          allocatedAmount: Number(selectedPayment.allocatedAmount),
          bankCurrency: reconAccount.currency,
          paymentCurrency: selectedPayment.currency,
          bankAccountCode: reconAccount.glAccountCode,
          paymentAccountCode: selectedPayment.modeOfPayment.accountCode,
          paymentType: selectedPayment.type,
        })
      : null,
  );
  const mutationBusy = $derived(matching || unmatchingId !== null);
  const canMatch = $derived(
    !!selectedTxn && !!selectedPayment && !!reconAccount && !mismatch && !mutationBusy && canManage,
  );
  async function matchTxn() {
    if (!canMatch || !selectedTxn || !selectedPayment) return;
    const txn = selectedTxn,
      payment = selectedPayment;
    matching = true;
    actionError = '';
    try {
      if (
        !(await confirmAction(
          `Associer « ${txn.description} » (${signedMoney(txn.amount)} ${payment.currency}) à ${payment.paymentNumber} ? Aucun transfert ni nouvelle écriture comptable ne sera effectué.`,
          { title: 'Confirmer le rapprochement ?', confirmLabel: 'Rapprocher', dangerous: false },
        ))
      )
        return;
      await api(`/billing/bank-transactions/${txn.id}/match`, {
        method: 'POST',
        body: { paymentId: payment.id },
      });
      toast.success('Rapprochement enregistré');
      await loadReconciliation();
    } catch (e) {
      actionError =
        e instanceof ApiError
          ? e.message
          : 'Rapprochement non confirmé. Actualisez avant de réessayer.';
    } finally {
      matching = false;
    }
  }
  let actionError = $state('');
  async function unmatchTxn(txnId: string) {
    if (mutationBusy || !canManage) return;
    unmatchingId = txnId;
    actionError = '';
    try {
      if (
        !(await confirmAction(
          'Retirer uniquement l’association entre ce mouvement et le paiement ? La comptabilisation et les soldes des factures restent inchangés.',
          { title: 'Retirer le rapprochement ?', confirmLabel: 'Retirer le rapprochement' },
        ))
      )
        return;
      await api(`/billing/bank-transactions/${txnId}/unmatch`, { method: 'POST' });
      toast.success('Rapprochement retiré');
      await loadReconciliation();
    } catch (e) {
      actionError = e instanceof ApiError ? e.message : 'Impossible de retirer le rapprochement.';
    } finally {
      unmatchingId = null;
    }
  }
</script>

<PageHeader title="Banque" subtitle="Comptes bancaires, transactions et rapprochement." />

<ErrorNotice message={contextError} />
{#if paymentContext}
  <div
    class="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge bg-surface-muted px-4 py-3"
  >
    <div>
      <p class="text-xs text-ink-muted">Paiement source</p>
      <a
        class="font-mono text-sm font-medium text-accent hover:underline"
        href={`/billing/payments/${encodeURIComponent(paymentContext.id)}`}
        >{paymentContext.paymentNumber}</a
      >
      <p class="mt-1 text-xs text-ink-muted">
        {money(paymentContext.totalAmount)}
        {paymentContext.currency} · {paymentContext.type === 'PAY'
          ? 'Décaissement'
          : 'Encaissement'}
      </p>
    </div>
    <Button variant="secondary" href={`/billing/payments/${encodeURIComponent(paymentContext.id)}`}
      >Retour au paiement</Button
    >
  </div>
{/if}
<p class="mb-5 max-w-3xl text-sm text-ink-muted">
  Rapprochez un mouvement du relevé avec un paiement comptabilisé, de même montant, sens et devise.
  Les frais, avances et paiements groupés ne sont pas pris en charge. Aucun transfert bancaire n’est
  effectué.
</p>
<Tabs
  bind:active={activeTab}
  label="Banque"
  tabs={[
    { id: 'accounts', label: 'Comptes' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'reconciliation', label: 'Rapprochement' },
  ]}
>
  <!-- ── Comptes ─────────────────────────────────────────────────────────────── -->
  {#if activeTab === 'accounts'}
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-sm font-semibold text-ink-muted">Comptes bancaires</h2>
      {#if canManage}<Button variant="primary" onclick={openCreateAccount}>+ Nouveau compte</Button
        >{/if}
    </div>

    <ErrorNotice message={errorAccounts} onretry={loadAccounts} />

    {#if loadingAccounts}
      <Card padded={false}><Skeleton rows={4} /></Card>
    {:else}
      <Table>
        {#snippet head()}
          <th>Nom</th>
          <th>N° (masqué)</th>
          <th>Compte GL</th>
          <th>Devise</th>
          <th>Défaut</th>
          <th class="text-right">Solde</th>
          <th></th>
        {/snippet}
        {#snippet body()}
          {#each accounts as acct (acct.id)}
            <tr>
              <td class="font-medium">{acct.name}</td>
              <td class="font-mono text-sm text-ink-muted">{acct.accountNumber ?? '—'}</td>
              <td class="font-mono text-sm">{acct.glAccountCode}</td>
              <td>{acct.currency}</td>
              <td>
                {#if acct.isDefault}
                  <Badge tone="ok">Défaut</Badge>
                {/if}
              </td>
              <td class="text-right tabular-nums">
                {#if loadingBalance[acct.id]}
                  <span class="text-xs text-ink-faint">…</span>
                {:else if balances[acct.id] !== undefined}
                  <span
                    class={Number(balances[acct.id].balance) < 0
                      ? 'text-danger font-semibold'
                      : 'font-semibold'}
                  >
                    {money(balances[acct.id].balance)}
                  </span>
                  <span class="ml-1 text-xs text-ink-faint">({balances[acct.id].txnCount} txn)</span
                  >
                {:else}
                  <span class="text-xs text-ink-faint">—</span>
                {/if}
              </td>
              <td class="text-right">
                <button
                  class="mr-2 text-xs text-accent hover:underline"
                  disabled={!canManage || !!deletingAccountId}
                  onclick={() => openEditAccount(acct)}>Modifier</button
                >
                <button
                  class="text-xs text-danger hover:underline disabled:opacity-40"
                  disabled={!!deletingAccountId || !canManage}
                  onclick={() => deleteAccount(acct)}
                  >{deletingAccountId === acct.id ? '…' : 'Supprimer'}</button
                >
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan={7}>
                <EmptyState title="Aucun compte" message="Créez votre premier compte bancaire." />
              </td>
            </tr>
          {/each}
        {/snippet}
      </Table>
    {/if}

    <!-- Account modal -->
    {#if showAccountModal}
      <Modal
        open
        title={editingAccount ? 'Modifier le compte' : 'Nouveau compte bancaire'}
        size="md"
        onclose={() => {
          showAccountModal = false;
        }}
        dismissible={!savingAccount}
      >
        <fieldset disabled={savingAccount} class="min-w-0 space-y-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-muted" for="acct-name">Nom</label>
            <input
              id="acct-name"
              bind:value={accountForm.name}
              placeholder="ex. Compte opérations BMO"
              class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-muted" for="acct-num">
              N° de compte {editingAccount ? '(laisser vide = inchangé)' : '(optionnel)'}
            </label>
            <input
              id="acct-num"
              bind:value={accountForm.accountNumber}
              placeholder="ex. 1234567890"
              class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="mb-1 block text-xs font-medium text-ink-muted" for="acct-gl"
                >Compte GL</label
              >
              <input
                id="acct-gl"
                bind:value={accountForm.glAccountCode}
                placeholder="1010"
                class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-ink-muted" for="acct-currency"
                >Devise</label
              >
              <input
                id="acct-currency"
                bind:value={accountForm.currency}
                placeholder="CAD"
                class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
            </div>
          </div>
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" bind:checked={accountForm.isDefault} class="rounded" />
            Compte par défaut
          </label>
        </fieldset>

        <ErrorNotice message={accountFormError} />
        {#snippet footer()}<div class="flex justify-end gap-2">
            <Button
              disabled={savingAccount}
              variant="secondary"
              onclick={() => {
                showAccountModal = false;
              }}>Annuler</Button
            >
            <Button
              variant="primary"
              disabled={savingAccount || !accountForm.name.trim()}
              onclick={saveAccount}
            >
              {savingAccount ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>{/snippet}
      </Modal>
    {/if}
  {/if}

  <!-- ── Transactions ───────────────────────────────────────────────────────── -->
  {#if activeTab === 'transactions'}
    <!-- Filters -->
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <div>
        <label class="mb-1 block text-xs font-medium text-ink-muted" for="txn-account">Compte</label
        >
        <select
          id="txn-account"
          bind:value={selectedAccountId}
          disabled={savingTxn || importingCsv}
          class="rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
        >
          <option value="">— Sélectionner un compte —</option>
          {#each accounts as acct (acct.id)}
            <option value={acct.id}>{acct.name}</option>
          {/each}
        </select>
      </div>
      <div>
        <label class="mb-1 block text-xs font-medium text-ink-muted" for="txn-status">Statut</label>
        <select
          id="txn-status"
          bind:value={statusFilter}
          class="rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
        >
          <option value="">— Tous —</option>
          <option value="UNRECONCILED">Non réconcilié</option>
          <option value="RECONCILED">Réconcilié</option>
        </select>
      </div>
      <div class="ml-auto flex gap-2 self-end">
        <Button
          variant="ghost"
          disabled={!canManage || savingTxn || importingCsv}
          onclick={() => {
            showTxnForm = !showTxnForm;
            resetTxnForm();
          }}
        >
          {showTxnForm ? 'Masquer le formulaire' : '+ Nouvelle transaction'}
        </Button>
      </div>
    </div>

    <!-- Manual create form -->
    {#if showTxnForm}
      <div class="mb-4">
        <Card>
          <h3 class="mb-3 text-sm font-bold text-ink">Nouvelle transaction manuelle</h3>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label class="mb-1 block text-xs font-medium text-ink-muted" for="txn-date"
                >Date</label
              >
              <input
                id="txn-date"
                type="date"
                bind:value={txnForm.date}
                class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
            </div>
            <div class="lg:col-span-2">
              <label class="mb-1 block text-xs font-medium text-ink-muted" for="txn-desc"
                >Description</label
              >
              <input
                id="txn-desc"
                bind:value={txnForm.description}
                placeholder="ex. Virement client ABC"
                class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs font-medium text-ink-muted" for="txn-amount"
                >Montant (+ dépôt / − retrait)</label
              >
              <input
                id="txn-amount"
                type="number"
                step="0.01"
                bind:value={txnForm.amount}
                placeholder="ex. 1250.00"
                class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
            </div>
            <div class="sm:col-span-2 lg:col-span-4">
              <label class="mb-1 block text-xs font-medium text-ink-muted" for="txn-ref"
                >Référence (optionnel)</label
              >
              <input
                id="txn-ref"
                bind:value={txnForm.reference}
                placeholder="ex. CHQ-001"
                class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
              />
            </div>
          </div>
          {#if txnFormError}
            <p class="mt-2 text-sm text-danger">{txnFormError}</p>
          {/if}
          <div class="mt-3 flex justify-end">
            <Button
              variant="primary"
              disabled={savingTxn || !canManage}
              onclick={createTransaction}
            >
              {savingTxn ? 'Création…' : 'Créer la transaction'}
            </Button>
          </div>
        </Card>
      </div>
    {/if}

    <!-- CSV import -->
    <div class="mb-4">
      <Card>
        <h3 class="mb-2 text-sm font-bold text-ink">Import CSV</h3>
        <p class="mb-2 text-xs text-ink-muted">
          Format : <code class="font-mono">date,description,amount[,reference]</code> (séparateur
          <code class="font-mono">,</code>
          ou <code class="font-mono">;</code>).
        </p>
        <textarea
          bind:value={csvText}
          rows={5}
          placeholder="date,description,amount,reference&#10;2026-01-15,Virement client,1250.00,REF001&#10;2026-01-16,Frais bancaires,-25.00"
          class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-2 font-mono text-xs focus:border-accent focus:outline-none"
        ></textarea>
        {#if importError}
          <p class="mt-1 text-sm text-danger">{importError}</p>
        {/if}
        {#if importResult}
          <div class="mt-2 rounded-lg border border-edge-soft p-3 text-sm">
            <p class="font-medium text-ok">{importResult.imported} transaction(s) importée(s)</p>
            {#if importResult.errors.length > 0}
              <ul class="mt-1 space-y-0.5 text-danger">
                {#each importResult.errors as err, i (i)}
                  <li class="text-xs">{err}</li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
        <div class="mt-2 flex justify-end">
          <Button
            variant="ghost"
            disabled={importingCsv || !csvText.trim() || !canManage}
            onclick={importCsv}
          >
            {importingCsv ? 'Import en cours…' : 'Importer'}
          </Button>
        </div>
      </Card>
    </div>

    <!-- Transaction list -->
    <ErrorNotice message={errorTxns} onretry={loadTransactions} />
    {#if !selectedAccountId}
      <Card>
        <EmptyState
          title="Sélectionnez un compte"
          message="Choisissez un compte bancaire pour voir ses transactions."
        />
      </Card>
    {:else if loadingTxns}
      <Card padded={false}><Skeleton rows={6} /></Card>
    {:else}
      <Table>
        {#snippet head()}
          <th>Date</th>
          <th>Description</th>
          <th>Référence</th>
          <th class="text-right">Montant</th>
          <th>Statut</th>
        {/snippet}
        {#snippet body()}
          {#each transactions as txn (txn.id)}
            <tr>
              <td class="font-mono text-sm text-ink-muted whitespace-nowrap">{fmtDate(txn.date)}</td
              >
              <td>{txn.description}</td>
              <td class="font-mono text-xs text-ink-faint">{txn.reference ?? '—'}</td>
              <td
                class={`text-right tabular-nums font-semibold ${Number(txn.amount) < 0 ? 'text-danger' : 'text-ok'}`}
              >
                {signedMoney(txn.amount)}
              </td>
              <td>
                <Badge tone={txnStatusTone(txn.status)}>{txnStatusLabel(txn.status)}</Badge>
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan={5}>
                <EmptyState
                  title="Aucune transaction"
                  message="Aucune transaction pour ce compte et ce filtre."
                />
              </td>
            </tr>
          {/each}
        {/snippet}
      </Table>
    {/if}
  {/if}

  <!-- ── Rapprochement ──────────────────────────────────────────────────────── -->
  {#if activeTab === 'reconciliation'}
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <label class="text-sm font-medium text-ink" for="recon-account">Compte</label>
      <select
        id="recon-account"
        disabled={mutationBusy}
        bind:value={reconAccountId}
        class="rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
      >
        <option value="">— Sélectionnez un compte —</option>
        {#each accounts as acct (acct.id)}
          <option value={acct.id}>{acct.name} ({acct.glAccountCode})</option>
        {/each}
      </select>
      {#if reconAccountId}
        <button
          class="text-xs text-accent hover:underline"
          disabled={mutationBusy || loadingRecon}
          onclick={loadReconciliation}>Actualiser</button
        >
      {/if}
    </div>

    <ErrorNotice message={errorRecon} onretry={loadReconciliation} />
    <ErrorNotice message={actionError} />
    {#if !canManage}<p class="mb-3 text-sm text-ink-muted">
        Lecture seule : le droit de gestion du grand livre est requis pour rapprocher.
      </p>{/if}

    {#if !reconAccountId}
      <Card>
        <EmptyState
          title="Sélectionnez un compte"
          message="Choisissez un compte pour démarrer le rapprochement."
        />
      </Card>
    {:else if loadingRecon}
      <Card padded={false}><Skeleton rows={8} /></Card>
    {:else if reconResult}
      <!-- Action bar -->
      {#if selectedTxnId && selectedPaymentId}
        <div
          class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3"
        >
          <span class="text-sm text-ink">1 transaction + 1 paiement sélectionnés</span>
          <Button variant="primary" disabled={!canMatch} onclick={matchTxn}>
            {matching ? 'Rapprochement…' : 'Rapprocher la sélection'}
          </Button>
          <button
            class="text-sm text-ink-muted hover:text-ink"
            disabled={mutationBusy}
            onclick={() => {
              selectedTxnId = null;
              selectedPaymentId = null;
            }}>Désélectionner</button
          >
        </div>
      {/if}

      {#if mismatch}<p class="mb-4 text-sm text-warn" role="status">{mismatch}</p>{/if}
      <div class="grid gap-4 lg:grid-cols-2">
        <!-- Left: unreconciled transactions -->
        <div>
          <h3 class="mb-2 text-sm font-semibold text-ink">
            Transactions non réconciliées
            <span class="ml-1 text-ink-faint">({reconResult.unreconciledTransactions.length})</span>
          </h3>
          {#if reconResult.unreconciledTransactions.length === 0}
            <Card>
              <EmptyState
                title="Tout est réconcilié"
                message="Aucune transaction non réconciliée."
              />
            </Card>
          {:else}
            <div class="space-y-2">
              {#each reconResult.unreconciledTransactions as txn (txn.id)}
                <button
                  class={`w-full rounded-lg border px-4 py-3 text-left transition ${selectedTxnId === txn.id ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-edge bg-surface hover:bg-surface-muted'}`}
                  disabled={mutationBusy || !canManage}
                  aria-pressed={selectedTxnId === txn.id}
                  onclick={() => {
                    selectedTxnId = selectedTxnId === txn.id ? null : txn.id;
                  }}
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium text-ink">{txn.description}</p>
                      <p class="text-xs text-ink-muted">
                        {fmtDate(txn.date)}{txn.reference ? ` · ${txn.reference}` : ''}
                      </p>
                    </div>
                    <span
                      class={`shrink-0 text-sm font-semibold tabular-nums ${Number(txn.amount) < 0 ? 'text-danger' : 'text-ok'}`}
                    >
                      {signedMoney(txn.amount)}
                    </span>
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Right: candidate payments -->
        <div>
          <h3 class="mb-2 text-sm font-semibold text-ink">
            Paiements candidats
            <span class="ml-1 text-ink-faint">({reconResult.candidatePayments.length})</span>
          </h3>
          {#if reconResult.candidatePayments.length === 0}
            <Card>
              <EmptyState
                title="Aucun paiement candidat"
                message="Aucun paiement comptabilisé à rapprocher pour ce compte comptable et cette devise."
              />
            </Card>
          {:else}
            <div class="space-y-2">
              {#each reconResult.candidatePayments as payment (payment.id)}
                <button
                  class={`w-full rounded-lg border px-4 py-3 text-left transition ${selectedPaymentId === payment.id ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-edge bg-surface hover:bg-surface-muted'}`}
                  disabled={mutationBusy || !canManage}
                  aria-pressed={selectedPaymentId === payment.id}
                  onclick={() => {
                    selectedPaymentId = selectedPaymentId === payment.id ? null : payment.id;
                  }}
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium text-ink">{payment.paymentNumber}</p>
                      <p class="text-xs text-ink-muted">
                        {fmtDate(payment.date)} · {payment.modeOfPayment.name} · {payment.type ===
                        'PAY'
                          ? 'Décaissement'
                          : 'Encaissement'}
                      </p>
                    </div>
                    <span class="shrink-0 text-sm font-semibold tabular-nums text-ink">
                      {money(payment.totalAmount)}
                      {payment.currency}
                    </span>
                  </div>
                </button>
              {/each}
            </div>
          {/if}

          <!-- Reconciled txns that can be un-matched — shown below candidates when there's nothing else -->
        </div>
      </div>

      <!-- Dé-matcher section: reconciled transactions -->
      {#if reconciledTxns.length > 0}
        <div class="mt-6">
          <h3 class="mb-2 text-sm font-semibold text-ink">
            Transactions réconciliées
            <span class="ml-1 text-ink-faint">({reconciledTxns.length})</span>
          </h3>
          <Table>
            {#snippet head()}
              <th>Date</th>
              <th>Description</th>
              <th>Référence</th>
              <th class="text-right">Montant</th>
              <th></th>
            {/snippet}
            {#snippet body()}
              {#each reconciledTxns as txn (txn.id)}
                <tr>
                  <td class="font-mono text-sm text-ink-muted whitespace-nowrap"
                    >{fmtDate(txn.date)}</td
                  >
                  <td>{txn.description}</td>
                  <td class="font-mono text-xs text-ink-faint">{txn.reference ?? '—'}</td>
                  <td
                    class={`text-right tabular-nums font-semibold ${Number(txn.amount) < 0 ? 'text-danger' : 'text-ok'}`}
                  >
                    {signedMoney(txn.amount)}
                  </td>
                  <td class="text-right">
                    {#if txn.matchedPaymentId && canReadPayments}<a
                        class="mr-3 text-xs text-accent hover:underline"
                        href={`/billing/payments/${encodeURIComponent(txn.matchedPaymentId)}`}
                        >Ouvrir le paiement</a
                      >{/if}
                    <button
                      class="text-xs text-warn hover:underline disabled:opacity-40"
                      disabled={mutationBusy || !canManage}
                      onclick={() => unmatchTxn(txn.id)}
                      >{unmatchingId === txn.id ? '…' : 'Retirer le rapprochement'}</button
                    >
                  </td>
                </tr>
              {/each}
            {/snippet}
          </Table>
        </div>
      {/if}
    {/if}
  {/if}
</Tabs>
