<script lang="ts">
  import { Modal } from '$lib/components/ui';
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

  type Tab = 'accounts' | 'transactions' | 'reconciliation';
  let activeTab = $state<Tab>('accounts');

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
    if (!selectedAccountId) {
      transactions = [];
      return;
    }
    loadingTxns = true;
    errorTxns = '';
    try {
      const query: Record<string, string> = { bankAccountId: selectedAccountId };
      if (statusFilter) query.status = statusFilter;
      transactions = await api<BankTransaction[]>('/billing/bank-transactions', { query });
    } catch (e) {
      errorTxns = e instanceof ApiError ? e.message : 'Échec du chargement des transactions';
    } finally {
      loadingTxns = false;
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
    if (!reconAccountId) {
      reconResult = null;
      reconciledTxns = [];
      return;
    }
    loadingRecon = true;
    errorRecon = '';
    selectedTxnId = null;
    selectedPaymentId = null;
    try {
      const [result, reconciled] = await Promise.all([
        api<ReconciliationResult>('/billing/bank-transactions/reconciliation', {
          query: { bankAccountId: reconAccountId },
        }),
        api<BankTransaction[]>('/billing/bank-transactions', {
          query: { bankAccountId: reconAccountId, status: 'RECONCILED' },
        }),
      ]);
      reconResult = result;
      reconciledTxns = reconciled;
    } catch (e) {
      errorRecon = e instanceof ApiError ? e.message : 'Échec du chargement de la réconciliation';
    } finally {
      loadingRecon = false;
    }
  }

  $effect(() => {
    void reconAccountId;
    if (activeTab === 'reconciliation') void loadReconciliation();
  });

  async function matchTxn() {
    if (!selectedTxnId || !selectedPaymentId) return;
    matching = true;
    try {
      await api(`/billing/bank-transactions/${selectedTxnId}/match`, {
        method: 'POST',
        body: { paymentId: selectedPaymentId },
      });
      toast.success('Transaction réconciliée');
      await loadReconciliation();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du matching');
    } finally {
      matching = false;
    }
  }

  async function unmatchTxn(txnId: string) {
    unmatchingId = txnId;
    try {
      await api(`/billing/bank-transactions/${txnId}/unmatch`, { method: 'POST' });
      toast.success('Réconciliation annulée');
      await loadReconciliation();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du dé-matching');
    } finally {
      unmatchingId = null;
    }
  }

  const canMatch = $derived(selectedTxnId !== null && selectedPaymentId !== null && !matching);
</script>

<PageHeader title="Banque" subtitle="Comptes bancaires, transactions et rapprochement." />

<!-- Tabs -->
<div class="mb-6 flex gap-1 rounded-xl bg-surface-muted p-1 w-fit">
  <button
    class={`rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === 'accounts' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}
    onclick={() => {
      activeTab = 'accounts';
    }}>Comptes</button
  >
  <button
    class={`rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === 'transactions' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}
    onclick={() => {
      activeTab = 'transactions';
    }}>Transactions</button
  >
  <button
    class={`rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === 'reconciliation' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}
    onclick={() => {
      activeTab = 'reconciliation';
    }}>Rapprochement</button
  >
</div>

<!-- ── Comptes ─────────────────────────────────────────────────────────────── -->
{#if activeTab === 'accounts'}
  <div class="mb-4 flex items-center justify-between">
    <h2 class="text-sm font-semibold text-ink-muted">Comptes bancaires</h2>
    <Button variant="primary" onclick={openCreateAccount}>+ Nouveau compte</Button>
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
                <span class="ml-1 text-xs text-ink-faint">({balances[acct.id].txnCount} txn)</span>
              {:else}
                <span class="text-xs text-ink-faint">—</span>
              {/if}
            </td>
            <td class="text-right">
              <button
                class="mr-2 text-xs text-accent hover:underline"
                onclick={() => openEditAccount(acct)}>Modifier</button
              >
              <button
                class="text-xs text-danger hover:underline disabled:opacity-40"
                disabled={deletingAccountId === acct.id}
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
      <div class="space-y-3">
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
      </div>

      {#if accountFormError}
        <p class="mt-3 text-sm text-danger">{accountFormError}</p>
      {/if}
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
      <label class="mb-1 block text-xs font-medium text-ink-muted" for="txn-account">Compte</label>
      <select
        id="txn-account"
        bind:value={selectedAccountId}
        class="rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
      >
        <option value="">— Tous les comptes —</option>
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
            <label class="mb-1 block text-xs font-medium text-ink-muted" for="txn-date">Date</label>
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
          <Button variant="primary" disabled={savingTxn} onclick={createTransaction}>
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
        <Button variant="ghost" disabled={importingCsv || !csvText.trim()} onclick={importCsv}>
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
            <td class="font-mono text-sm text-ink-muted whitespace-nowrap">{fmtDate(txn.date)}</td>
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
  <div class="mb-4 flex items-center gap-3">
    <label class="text-sm font-medium text-ink" for="recon-account">Compte</label>
    <select
      id="recon-account"
      bind:value={reconAccountId}
      class="rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
    >
      <option value="">— Sélectionnez un compte —</option>
      {#each accounts as acct (acct.id)}
        <option value={acct.id}>{acct.name} ({acct.glAccountCode})</option>
      {/each}
    </select>
    {#if reconAccountId}
      <button class="text-xs text-accent hover:underline" onclick={loadReconciliation}
        >Actualiser</button
      >
    {/if}
  </div>

  <ErrorNotice message={errorRecon} onretry={loadReconciliation} />

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
        class="mb-4 flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-3"
      >
        <span class="text-sm text-ink">1 transaction + 1 paiement sélectionnés</span>
        <Button variant="primary" disabled={!canMatch} onclick={matchTxn}>
          {matching ? 'Matching…' : 'Matcher'}
        </Button>
        <button
          class="text-sm text-ink-muted hover:text-ink"
          onclick={() => {
            selectedTxnId = null;
            selectedPaymentId = null;
          }}>Désélectionner</button
        >
      </div>
    {/if}

    <div class="grid gap-4 lg:grid-cols-2">
      <!-- Left: unreconciled transactions -->
      <div>
        <h3 class="mb-2 text-sm font-semibold text-ink">
          Transactions non réconciliées
          <span class="ml-1 text-ink-faint">({reconResult.unreconciledTransactions.length})</span>
        </h3>
        {#if reconResult.unreconciledTransactions.length === 0}
          <Card>
            <EmptyState title="Tout est réconcilié" message="Aucune transaction non réconciliée." />
          </Card>
        {:else}
          <div class="space-y-2">
            {#each reconResult.unreconciledTransactions as txn (txn.id)}
              <button
                class={`w-full rounded-lg border px-4 py-3 text-left transition ${selectedTxnId === txn.id ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-edge bg-surface hover:bg-surface-muted'}`}
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
              message="Aucun paiement SUBMITTED non réconcilié pour ce compte GL."
            />
          </Card>
        {:else}
          <div class="space-y-2">
            {#each reconResult.candidatePayments as payment (payment.id)}
              <button
                class={`w-full rounded-lg border px-4 py-3 text-left transition ${selectedPaymentId === payment.id ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-edge bg-surface hover:bg-surface-muted'}`}
                onclick={() => {
                  selectedPaymentId = selectedPaymentId === payment.id ? null : payment.id;
                }}
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-ink">{payment.paymentNumber}</p>
                    <p class="text-xs text-ink-muted">
                      {fmtDate(payment.date)} · {payment.modeOfPayment.name} · {payment.partyType}
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
                  <button
                    class="text-xs text-warn hover:underline disabled:opacity-40"
                    disabled={unmatchingId === txn.id}
                    onclick={() => unmatchTxn(txn.id)}
                    >{unmatchingId === txn.id ? '…' : 'Dé-matcher'}</button
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
