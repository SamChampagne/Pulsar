<script lang="ts">
  import { untrack } from 'svelte';
  import {
    CURRENCIES,
    formatLedgerAmount,
    ledgerCents,
    ledgerAmount,
    validateLedgerLines,
    isCalendarDate,
  } from '@pulsar/shared';
  import LedgerCoverage from '$lib/components/billing/LedgerCoverage.svelte';
  import {
    readLedgerIntent,
    rememberLedgerIntent,
    type LedgerIntent,
  } from '$lib/billing/ledger-intent';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { PERMISSIONS } from '@pulsar/shared';
  import { auth } from '$lib/stores/auth';
  import { confirmAction } from '$lib/stores/confirmation';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Tabs,
    Drawer,
    Field,
    Input,
    Select,
    Card,
    Table,
    Badge,
    Button,
    EmptyState,
    Skeleton,
    ErrorNotice,
    EntityPicker,
    type Tone,
  } from '$lib/components/ui';

  // ── Types ────────────────────────────────────────────────────────────────────

  interface ChartAccount {
    id: string;
    code: string;
    name: string;
    type: string;
    active: boolean;
  }

  interface JournalLine {
    accountId: string;
    account?: { code: string; name: string };
    debit: string;
    credit: string;
    memo: string | null;
  }

  interface JournalEntry {
    originalCurrency: string | null;
    currencyQualification?: { state: string; currency: string | null; version: number } | null;
    currency: string | null;
    id: string;
    date: string;
    memo: string | null;
    sourceType: string | null;
    sourceId: string | null;
    sourceKind: string | null;
    lines: JournalLine[];
  }

  interface TrialBalanceRow {
    code: string;
    name: string;
    type: string;
    debit: string;
    credit: string;
    balance: string;
  }

  interface TrialBalance {
    currency: string;
    coverage: {
      unknownEntries: number;
      selectedEntries: number;
      otherCurrencies: { currency: string; count: number }[];
    };
    rows: TrialBalanceRow[];
    totalDebit: string;
    totalCredit: string;
  }

  interface Paginated<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
  }

  // ── Tabs ─────────────────────────────────────────────────────────────────────

  type Tab = 'chart' | 'journal' | 'balance';
  let activeTab = $state<string>('chart');
  const tabs = [
    { id: 'chart', label: 'Plan comptable' },
    { id: 'journal', label: 'Journal' },
    { id: 'balance', label: 'Balance' },
  ];
  const sourceType = $derived(page.url.searchParams.get('sourceType') || '');
  const sourceId = $derived(page.url.searchParams.get('sourceId') || '');
  const canManage = $derived($auth?.user.permissions.includes(PERMISSIONS.BILLING.LEDGER_MANAGE));
  let accountId = $state('');
  let balanceCurrency = $state(''),
    journalCurrency = $state(''),
    manualCurrency = $state('');
  let balanceGeneration = 0;
  const intentKey = $derived('pulsar:ledger-manual:' + $auth?.tenant.id + ':' + $auth?.user.id);
  let pending = $state<LedgerIntent | null>(null),
    intentError = $state('');
  $effect(() => {
    void intentKey;
    untrack(() => {
      try {
        pending = readLedgerIntent(intentKey);
        intentError = '';
        if (pending) {
          manualDate = pending.date;
          manualCurrency = pending.currency;
          manualMemo = pending.memo ?? '';
          manualLines = pending.lines.map((l) => ({
            accountCode: l.accountCode,
            debit: l.debit ?? '0',
            credit: l.credit ?? '0',
            memo: l.memo ?? '',
          }));
          showManualForm = true;
        }
      } catch (e) {
        intentError = (e as Error).message;
      }
    });
  });
  $effect(() => {
    if (page.url.searchParams.get('unqualified') === 'true') {
      journalCurrency = 'UNQUALIFIED';
      activeTab = 'journal';
    }
  });
  let dateFrom = $state('');
  let dateTo = $state('');
  let journalGeneration = 0;
  function sourceHref(entry: Pick<JournalEntry, 'sourceType' | 'sourceId'>) {
    if (!entry.sourceId) return '';
    const id = encodeURIComponent(entry.sourceId);
    const permissions = $auth?.user.permissions ?? [];
    if (entry.sourceType === 'payment' && permissions.includes(PERMISSIONS.BILLING.PAYMENTS_READ))
      return `/billing/payments/${id}`;
    if (entry.sourceType === 'invoice' && permissions.includes(PERMISSIONS.BILLING.INVOICES_READ))
      return `/invoices?invoice=${id}`;
    if (
      entry.sourceType === 'customer-invoice' &&
      permissions.includes(PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ)
    )
      return `/invoices?statement=${id}`;
    return '';
  }
  async function clearSource() {
    const url = new URL(page.url);
    url.searchParams.delete('sourceType');
    url.searchParams.delete('sourceId');
    await goto(url.pathname + url.search, { keepFocus: true, noScroll: true });
  }
  $effect(() => {
    if (sourceType || sourceId) activeTab = 'journal';
  });
  $effect(() => {
    void sourceType;
    void sourceId;
    void accountId;
    void journalCurrency;
    void dateFrom;
    void dateTo;
    journalPage = 1;
  });

  // ── State ─────────────────────────────────────────────────────────────────────

  let loadingChart = $state(true);
  let loadingJournal = $state(true);
  let loadingBalance = $state(true);

  let errorChart = $state('');
  let errorJournal = $state('');
  let errorBalance = $state('');

  let accounts = $state<ChartAccount[]>([]);
  let journalPage = $state(1);
  let journalPageSize = $state(25);
  let journalEntries = $state<JournalEntry[]>([]);
  let journalTotal = $state(0);

  let trialBalance = $state<TrialBalance | null>(null);
  let asOf = $state('');

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function money(val: string | null): string {
    if (val === null || val === undefined) return '—';
    try {
      return formatLedgerAmount(String(val));
    } catch {
      return '—';
    }
  }

  function fmtDate(iso: string): string {
    return iso.slice(0, 10);
  }

  const ACCOUNT_TYPE_TONE: Record<string, Tone> = {
    ASSET: 'info',
    LIABILITY: 'warn',
    EQUITY: 'ok',
    REVENUE: 'ok',
    EXPENSE: 'neutral',
  };

  function accountTypeTone(type: string): Tone {
    return ACCOUNT_TYPE_TONE[type] ?? 'neutral';
  }

  const totalPages = $derived(Math.ceil(journalTotal / journalPageSize));

  const balanceBalanced = $derived(
    trialBalance !== null && trialBalance.totalDebit === trialBalance.totalCredit,
  );

  // ── Load functions ────────────────────────────────────────────────────────────

  async function loadChart() {
    loadingChart = true;
    errorChart = '';
    try {
      accounts = await api<ChartAccount[]>('/billing/ledger/accounts');
    } catch (e) {
      errorChart = e instanceof ApiError ? e.message : 'Échec du chargement du plan comptable';
    } finally {
      loadingChart = false;
    }
  }

  async function loadJournal() {
    const request = ++journalGeneration;
    const query = {
      page: journalPage,
      pageSize: journalPageSize,
      currency: journalCurrency === 'UNQUALIFIED' ? undefined : journalCurrency || undefined,
      unqualified: journalCurrency === 'UNQUALIFIED' ? 'true' : undefined,
      sourceType: sourceType || undefined,
      sourceId: sourceId || undefined,
      accountId: accountId || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    };
    loadingJournal = true;
    journalEntries = [];
    journalTotal = 0;
    errorJournal = '';
    try {
      const result = await api<Paginated<JournalEntry>>('/billing/ledger/journal', {
        query,
      });
      if (request !== journalGeneration) return;
      journalEntries = result.items;
      journalTotal = result.total;
    } catch (e) {
      if (request !== journalGeneration) return;
      errorJournal = e instanceof ApiError ? e.message : 'Échec du chargement du journal';
    } finally {
      if (request === journalGeneration) loadingJournal = false;
    }
  }

  async function loadBalance() {
    const g = ++balanceGeneration;
    trialBalance = null;
    errorBalance = '';
    loadingBalance = false;
    if (!balanceCurrency) return;
    loadingBalance = true;
    try {
      const r = await api<TrialBalance>('/billing/ledger/trial-balance', {
        query: { currency: balanceCurrency, asOf: asOf || undefined },
      });
      if (g === balanceGeneration) trialBalance = r;
    } catch (e) {
      if (g === balanceGeneration) errorBalance = (e as Error).message;
    } finally {
      if (g === balanceGeneration) loadingBalance = false;
    }
  }

  // ── Reactive loads ────────────────────────────────────────────────────────────

  $effect(() => {
    void loadChart();
  });

  $effect(() => {
    // read synchronously so the effect tracks pagination changes
    void journalPage;
    void journalPageSize;
    void loadJournal();
  });

  $effect(() => {
    void loadBalance();
  });

  function goJournalPage(p: number) {
    journalPage = p;
  }

  // ── Manual journal entry ───────────────────────────────────────────────────────

  interface ManualLine {
    accountCode: string;
    debit: string;
    credit: string;
    memo: string;
  }

  // Gated by the billing `ledgerManualEntries` setting.
  let manualEntriesEnabled = $state(false);
  let showManualForm = $state(false);
  let manualDate = $state('');
  let manualMemo = $state('');
  let manualLines = $state<ManualLine[]>([
    { accountCode: '', debit: '', credit: '', memo: '' },
    { accountCode: '', debit: '', credit: '', memo: '' },
  ]);
  let manualSaving = $state(false);
  let manualError = $state('');

  function exactSum(side: 'debit' | 'credit') {
    try {
      return ledgerAmount(
        manualLines.reduce((s, l) => s + ledgerCents(String(l[side] || '0')), 0n),
      );
    } catch {
      return '0.00';
    }
  }
  const manualTotalDebit = $derived(exactSum('debit')),
    manualTotalCredit = $derived(exactSum('credit'));
  const manualBalanced = $derived.by(() => {
    try {
      validateLedgerLines(
        manualLines.map((l) => ({
          ...l,
          debit: String(l.debit || '0'),
          credit: String(l.credit || '0'),
        })),
      );
      return true;
    } catch {
      return false;
    }
  });

  async function loadSettings() {
    try {
      const res = await api<{ values: Record<string, string | number | boolean> }>(
        '/modules/billing/settings',
      );
      manualEntriesEnabled = res.values.ledgerManualEntries !== false;
    } catch {
      // Settings unavailable: hide the manual form (default false).
      manualEntriesEnabled = false;
    }
  }

  function addManualLine() {
    manualLines = [...manualLines, { accountCode: '', debit: '', credit: '', memo: '' }];
  }

  function removeManualLine(index: number) {
    if (manualLines.length <= 2) return;
    manualLines = manualLines.filter((_, i) => i !== index);
  }

  function resetManualForm() {
    manualDate = '';
    manualCurrency = '';
    manualMemo = '';
    manualLines = [
      { accountCode: '', debit: '', credit: '', memo: '' },
      { accountCode: '', debit: '', credit: '', memo: '' },
    ];
    manualError = '';
  }

  async function finishManual() {
    localStorage.removeItem(intentKey);
    pending = null;
    resetManualForm();
    showManualForm = false;
    await Promise.all([loadJournal(), loadBalance()]);
  }
  async function executeManual(p: LedgerIntent) {
    if (manualSaving || !canManage) return;
    manualSaving = true;
    manualError = '';
    try {
      rememberLedgerIntent(intentKey, p);
      pending = p;
      await api('/billing/ledger/entries', { method: 'POST', body: p });
      await finishManual();
      toast.success('Écriture conservée, sans doublon.');
    } catch (e) {
      manualError = (e as Error).message;
    } finally {
      manualSaving = false;
    }
  }
  async function verifyManual() {
    if (!pending || manualSaving) return;
    manualSaving = true;
    manualError = '';
    try {
      await api('/billing/ledger/requests/' + pending.operationKey);
      await finishManual();
      toast.success('Écriture retrouvée dans le journal.');
    } catch (e) {
      manualError =
        e instanceof ApiError && e.statusCode === 404
          ? 'Aucune écriture trouvée : reprenez exactement la même demande.'
          : (e as Error).message;
    } finally {
      manualSaving = false;
    }
  }
  async function submitManualEntry() {
    if (manualSaving || pending || intentError || !canManage || !manualEntriesEnabled) return;
    manualError = '';
    let lines: ReturnType<typeof validateLedgerLines>;
    try {
      if (!isCalendarDate(manualDate) || !CURRENCIES.some((c) => c.code === manualCurrency))
        throw Error('Choisissez explicitement une date civile réelle et une devise.');
      lines = validateLedgerLines(
        manualLines.map((l) => ({
          ...l,
          debit: String(l.debit || '0'),
          credit: String(l.credit || '0'),
        })),
      );
    } catch (e) {
      manualError = (e as Error).message;
      return;
    }
    const body: LedgerIntent = {
      date: manualDate,
      currency: manualCurrency,
      memo: manualMemo.trim(),
      lines,
      operationKey: crypto.randomUUID(),
    };
    manualSaving = true;
    let confirmed = false;
    try {
      confirmed = await confirmAction(
        'Écriture définitive en ' +
          body.currency +
          '. Vérifiez la date, les comptes et les montants. Aucun change ou clôture de période n’est appliqué.',
        { title: 'Comptabiliser l’écriture ?', confirmLabel: 'Comptabiliser', dangerous: false },
      );
    } finally {
      manualSaving = false;
    }
    if (!confirmed) return;
    await executeManual(body);
  }

  $effect(() => {
    void loadSettings();
  });
  function closeManual() {
    if (manualSaving) return false;
    if (pending) return true;
    if (
      !manualDate &&
      !manualMemo &&
      !manualLines.some((l) => l.accountCode || l.debit || l.credit || l.memo) &&
      manualLines.length === 2
    )
      return true;
    void confirmAction('Les lignes non enregistrées seront abandonnées.', {
      title: 'Fermer la saisie ?',
      confirmLabel: 'Abandonner',
    }).then((accepted) => {
      if (accepted) {
        showManualForm = false;
        resetManualForm();
      }
    });
    return false;
  }
</script>

<PageHeader
  title="Grand livre"
  subtitle="Plan comptable, journal des écritures et balance de vérification."
/>

<svelte:head><title>Grand livre · Pulsar</title></svelte:head>
<a
  class="mb-4 inline-block text-sm text-accent hover:underline"
  href="/billing/ledger-qualification">Reprise documentée du journal historique</a
>
<Tabs {tabs} bind:active={activeTab} label="Vues du grand livre">
  <!-- ── Plan comptable ──────────────────────────────────────────────────────── -->
  {#if activeTab === 'chart'}
    <ErrorNotice message={errorChart} onretry={loadChart} />
    {#if loadingChart}
      <Card padded={false}><Skeleton rows={8} /></Card>
    {:else}
      <Table>
        {#snippet head()}
          <th>Code</th>
          <th>Nom</th>
          <th>Type</th>
          <th>Statut</th>
        {/snippet}
        {#snippet body()}
          {#each accounts as account (account.id)}
            <tr>
              <td class="font-mono text-sm">{account.code}</td>
              <td class="font-medium">{account.name}</td>
              <td><Badge tone={accountTypeTone(account.type)}>{account.type}</Badge></td>
              <td>
                <Badge tone={account.active ? 'ok' : 'neutral'}>
                  {account.active ? 'Actif' : 'Inactif'}
                </Badge>
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan={4}>
                <EmptyState title="Aucun compte" message="Le plan comptable est vide." />
              </td>
            </tr>
          {/each}
        {/snippet}
      </Table>
    {/if}
  {/if}

  <!-- ── Journal ────────────────────────────────────────────────────────────── -->
  {#if activeTab === 'journal'}
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-ink-muted">Écritures comptabilisées · {journalTotal} résultat(s)</p>
      {#if manualEntriesEnabled && canManage}
        <Button
          onclick={() => {
            showManualForm = true;
          }}>Nouvelle écriture manuelle</Button
        >
      {/if}
    </div>
    {#if sourceType || sourceId}
      <div
        class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-edge bg-surface-muted p-3 text-sm"
      >
        <span>Journal filtré sur {sourceType === 'payment' ? 'ce paiement' : 'cette source'}</span>
        {#if sourceHref({ sourceType, sourceId })}<a
            class="text-accent hover:underline"
            href={sourceHref({ sourceType, sourceId })}>Ouvrir la source</a
          >{/if}
        <Button variant="ghost" onclick={clearSource}>Voir toutes les écritures</Button>
      </div>
    {/if}
    <div class="mb-4 max-w-sm">
      <Field label="Devise du journal"
        ><Select bind:value={journalCurrency}
          ><option value="">Toutes, sans total commun</option><option value="UNQUALIFIED"
            >Sans devise — à qualifier</option
          >{#each CURRENCIES as c}<option value={c.code}>{c.code}</option>{/each}</Select
        ></Field
      >
    </div>
    <div class="mb-4 grid gap-3 sm:grid-cols-3">
      <Field label="Compte"
        ><Select bind:value={accountId}
          ><option value="">Tous les comptes</option>{#each accounts as account}<option
              value={account.id}>{account.code} · {account.name}</option
            >{/each}</Select
        ></Field
      >
      <Field label="Depuis"><Input type="date" bind:value={dateFrom} /></Field>
      <Field label="Jusqu’au"><Input type="date" bind:value={dateTo} /></Field>
    </div>
    <ErrorNotice message={errorJournal} onretry={loadJournal} />
    {#if loadingJournal}
      <Card padded={false}><Skeleton rows={8} /></Card>
    {:else if !errorJournal}
      <div class="space-y-3">
        {#each journalEntries as entry (entry.id)}
          <Card>
            <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <span class="font-mono text-xs text-ink-faint">{fmtDate(entry.date)}</span>
                <span class="ml-2 text-sm font-medium"
                  >{entry.currency ?? 'Sans devise — à qualifier'}</span
                >
                <span class="ml-2"
                  ><Badge tone={entry.sourceKind === 'reversal' ? 'warn' : 'neutral'}
                    >{entry.sourceKind === 'reversal'
                      ? 'Contrepassation'
                      : entry.sourceType === 'payment'
                        ? 'Paiement'
                        : entry.sourceType === 'invoice'
                          ? 'Facture transporteur'
                          : entry.sourceType === 'customer-invoice'
                            ? 'Relevé client'
                            : entry.sourceType || 'Écriture manuelle'}</Badge
                  ></span
                >
                {#if sourceHref(entry)}<a
                    class="ml-2 text-xs font-medium text-accent hover:underline"
                    href={sourceHref(entry)}>Ouvrir la source</a
                  >{/if}
                {#if entry.originalCurrency === null}<a
                    class="ml-2 text-xs text-accent hover:underline"
                    href={'/billing/ledger-qualification?entryId=' + encodeURIComponent(entry.id)}
                    >{entry.currencyQualification?.state === 'QUALIFIED'
                      ? 'Devise qualifiée sur preuve'
                      : 'Examiner la devise historique'}</a
                  >{/if}
              </div>
              {#if entry.memo}
                <span class="text-sm text-ink-muted">{entry.memo}</span>
              {/if}
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-edge-soft text-xs text-ink-faint">
                    <th class="pb-1 text-left font-medium">Compte</th>
                    <th class="pb-1 text-right font-medium">Débit</th>
                    <th class="pb-1 text-right font-medium">Crédit</th>
                    {#if entry.lines.some((l) => l.memo)}
                      <th class="pb-1 text-left font-medium">Note</th>
                    {/if}
                  </tr>
                </thead>
                <tbody>
                  {#each entry.lines as line, i (i)}
                    <tr class="border-b border-edge-soft/50 last:border-0">
                      <td class="py-1">
                        {#if line.account}
                          <span class="font-mono text-ink-muted text-xs">{line.account.code}</span>
                          <span class="ml-2">{line.account.name}</span>
                        {:else}
                          <span class="font-mono text-xs">{line.accountId}</span>
                        {/if}
                      </td>
                      <td class="py-1 text-right tabular-nums">
                        {Number(line.debit) !== 0 ? money(line.debit) : ''}
                      </td>
                      <td class="py-1 text-right tabular-nums">
                        {Number(line.credit) !== 0 ? money(line.credit) : ''}
                      </td>
                      {#if entry.lines.some((l) => l.memo)}
                        <td class="py-1 text-xs text-ink-muted">{line.memo ?? ''}</td>
                      {/if}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </Card>
        {:else}
          <Card>
            <EmptyState
              title="Aucune écriture"
              message="Aucune écriture ne correspond à cette source et à ces filtres."
            />
          </Card>
        {/each}
      </div>

      <!-- Pagination -->
      {#if journalTotal > journalPageSize}
        <div class="mt-4 flex items-center justify-between text-sm text-ink-muted">
          <span>{journalTotal} écriture{journalTotal > 1 ? 's' : ''} au total</span>
          <div class="flex gap-1">
            <button
              class="rounded px-2 py-1 hover:bg-surface-muted disabled:opacity-40"
              disabled={journalPage <= 1}
              onclick={() => goJournalPage(journalPage - 1)}>‹ Préc.</button
            >
            <span class="px-2 py-1">{journalPage} / {totalPages}</span>
            <button
              class="rounded px-2 py-1 hover:bg-surface-muted disabled:opacity-40"
              disabled={journalPage >= totalPages}
              onclick={() => goJournalPage(journalPage + 1)}>Suiv. ›</button
            >
          </div>
        </div>
      {/if}
    {/if}
  {/if}

  <!-- ── Balance de vérification ────────────────────────────────────────────── -->
  {#if activeTab === 'balance'}
    <div class="mb-4 max-w-sm">
      <Field label="Devise de la balance"
        ><Select bind:value={balanceCurrency}
          ><option value="">Choisir une devise</option>{#each CURRENCIES as c}<option value={c.code}
              >{c.code} · {c.name}</option
            >{/each}</Select
        ></Field
      >
    </div>
    {#if trialBalance}<LedgerCoverage
        currency={trialBalance.currency}
        coverage={trialBalance.coverage}
      />{/if}
    <div class="mb-4 flex items-center gap-3">
      <label class="text-sm font-medium text-ink" for="asof-input">Au</label>
      <input
        id="asof-input"
        type="date"
        bind:value={asOf}
        class="rounded-lg border border-edge px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <span class="text-xs text-ink-faint">(laisser vide pour inclure toutes les dates)</span>
    </div>

    <ErrorNotice message={errorBalance} onretry={loadBalance} />

    {#if loadingBalance}
      <Card padded={false}><Skeleton rows={8} /></Card>
    {:else if trialBalance}
      <p class="mb-2 text-xs text-ink-muted sm:hidden">
        Faites défiler le tableau horizontalement pour consulter débits, crédits et soldes.
      </p>
      <Card padded={false}>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[40rem]">
            <thead>
              <tr
                class="border-b border-edge text-xs font-semibold tracking-wide text-ink-faint uppercase"
              >
                <th class="px-4 py-3 text-left">Code</th>
                <th class="px-4 py-3 text-left">Compte</th>
                <th class="px-4 py-3 text-left">Type</th>
                <th class="px-4 py-3 text-right">Débit</th>
                <th class="px-4 py-3 text-right">Crédit</th>
                <th class="px-4 py-3 text-right">Solde</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-edge-soft">
              {#each trialBalance.rows as row (row.code)}
                <tr class="text-sm hover:bg-surface-muted/50">
                  <td class="px-4 py-2.5 font-mono text-ink-muted">{row.code}</td>
                  <td class="px-4 py-2.5 font-medium">{row.name}</td>
                  <td class="px-4 py-2.5">
                    <Badge tone={accountTypeTone(row.type)}>{row.type}</Badge>
                  </td>
                  <td class="px-4 py-2.5 text-right tabular-nums">{money(row.debit)}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums">{money(row.credit)}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums font-semibold"
                    >{money(row.balance)}</td
                  >
                </tr>
              {:else}
                <tr>
                  <td colspan={6} class="px-4 py-6">
                    <EmptyState
                      title="Aucun solde"
                      message="Aucune donnée disponible pour cette période."
                    />
                  </td>
                </tr>
              {/each}
            </tbody>
            <tfoot class="border-t-2 border-edge">
              <tr class="text-sm font-bold">
                <td class="px-4 py-3" colspan={3}>Total</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(trialBalance.totalDebit)}</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(trialBalance.totalCredit)}</td>
                <td class="px-4 py-3 text-right">
                  {#if balanceBalanced}
                    <Badge tone="ok">Équilibre arithmétique</Badge>
                  {:else}
                    <Badge tone="danger">Déséquilibré</Badge>
                  {/if}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    {:else}
      <Card>
        <EmptyState
          title="Aucune balance"
          message={balanceCurrency
            ? 'Impossible de charger la balance de vérification.'
            : 'Choisissez une devise. Les écritures historiques sans devise restent à qualifier.'}
        />
      </Card>
    {/if}
  {/if}
</Tabs>
<Drawer
  bind:open={showManualForm}
  title="Nouvelle écriture manuelle"
  width="xl"
  dismissible={!manualSaving}
  onbeforeclose={closeManual}
>
  <p class="mb-4 text-sm text-ink-muted">
    Les débits et crédits doivent être équilibrés. L’enregistrement crée une écriture définitive,
    pas un brouillon. Cette écriture manuelle est indépendante de la source filtrée.
  </p>
  {#if intentError}<p role="alert" class="mb-3 text-danger">{intentError}</p>{/if}
  {#if pending}<section class="mb-4 space-y-2 rounded-md border border-warn/40 p-3">
      <h3 class="font-medium">Écriture à vérifier</h3>
      <p class="text-sm">
        La demande exacte en {pending.currency} du {pending.date} est conservée. Ne créez pas une autre
        écriture.
      </p>
      <div class="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={manualSaving || !canManage} onclick={verifyManual}
          >Vérifier l’écriture</Button
        ><Button
          variant="secondary"
          disabled={manualSaving || !canManage}
          onclick={() => {
            if (pending) void executeManual(pending);
          }}>Reprendre la même écriture</Button
        >
      </div>
    </section>{/if}
  {#if manualError}<p role="alert" class="mb-3 text-danger">{manualError}</p>{/if}
  <fieldset class="min-w-0" disabled={manualSaving || !!pending || !!intentError}>
    <div class="mb-4">
      <Field label="Devise de l’écriture"
        ><Select bind:value={manualCurrency}
          ><option value="">Choisir explicitement</option>{#each CURRENCIES as c}<option
              value={c.code}>{c.code} · {c.name}</option
            >{/each}</Select
        ></Field
      >
    </div>
    <div class="mb-3 grid gap-3 sm:grid-cols-2">
      <div>
        <label class="mb-1 block text-xs font-medium text-ink-muted" for="manual-date">Date</label>
        <input
          id="manual-date"
          type="date"
          bind:value={manualDate}
          class="w-full rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
        <p class="mt-1 text-xs text-ink-faint">
          Date civile obligatoire, conservée sans conversion de fuseau.
        </p>
      </div>
      <div>
        <label class="mb-1 block text-xs font-medium text-ink-muted" for="manual-memo"
          >Description</label
        >
        <input
          id="manual-memo"
          placeholder="Mémo de l'écriture"
          bind:value={manualMemo}
          class="w-full rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
      </div>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-edge-soft text-xs text-ink-faint">
            <th class="pb-1 text-left font-medium">Compte (code)</th>
            <th class="pb-1 text-right font-medium">Débit</th>
            <th class="pb-1 text-right font-medium">Crédit</th>
            <th class="pb-1 text-left font-medium">Note</th>
            <th class="pb-1"></th>
          </tr>
        </thead>
        <tbody>
          {#each manualLines as line, i (i)}
            <tr class="border-b border-edge-soft/50 last:border-0">
              <td class="py-1 pr-2">
                <div class="w-36">
                  <EntityPicker
                    endpoint="/billing/ledger/accounts"
                    label={`Compte · ligne ${i + 1}`}
                    placeholder="ex. 1000"
                    listShape="array"
                    valueKey="code"
                    labelKey="code"
                    detailKey="name"
                    bind:value={line.accountCode}
                  />
                </div>
              </td>
              <td class="py-1 px-1 text-right">
                <input
                  type="text"
                  inputmode="decimal"
                  step="0.01"
                  min="0"
                  aria-label={`Débit · ligne ${i + 1}`}
                  bind:value={line.debit}
                  class="w-28 rounded border border-edge bg-surface px-2 py-1 text-right text-sm focus:border-accent focus:outline-none"
                />
              </td>
              <td class="py-1 px-1 text-right">
                <input
                  type="text"
                  inputmode="decimal"
                  step="0.01"
                  min="0"
                  aria-label={`Crédit · ligne ${i + 1}`}
                  bind:value={line.credit}
                  class="w-28 rounded border border-edge bg-surface px-2 py-1 text-right text-sm focus:border-accent focus:outline-none"
                />
              </td>
              <td class="py-1 px-1">
                <input
                  aria-label={`Note · ligne ${i + 1}`}
                  bind:value={line.memo}
                  placeholder="(optionnel)"
                  class="w-full rounded border border-edge bg-surface px-2 py-1 text-sm focus:border-accent focus:outline-none"
                />
              </td>
              <td class="py-1 pl-1 text-right">
                <button
                  class="text-ink-faint hover:text-danger disabled:opacity-30"
                  disabled={manualLines.length <= 2}
                  aria-label={`Supprimer la ligne ${i + 1}`}
                  title="Supprimer la ligne"
                  onclick={() => removeManualLine(i)}>✕</button
                >
              </td>
            </tr>
          {/each}
        </tbody>
        <tfoot class="border-t border-edge">
          <tr class="text-xs font-semibold">
            <td class="py-2">
              <button class="text-accent hover:underline" onclick={addManualLine}
                >+ Ajouter une ligne</button
              >
            </td>
            <td class="py-2 text-right tabular-nums">{money(String(manualTotalDebit))}</td>
            <td class="py-2 text-right tabular-nums">{money(String(manualTotalCredit))}</td>
            <td class="py-2" colspan={2}>
              {#if manualBalanced}
                <Badge tone="ok">Équilibré ✓</Badge>
              {:else}
                <Badge tone="warn">Déséquilibré</Badge>
              {/if}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  </fieldset>
  {#snippet footer()}
    <Button
      variant="secondary"
      disabled={manualSaving}
      onclick={() => {
        if (closeManual()) showManualForm = false;
      }}>Fermer</Button
    >
    <Button
      disabled={manualSaving ||
        !manualBalanced ||
        !manualCurrency ||
        !manualDate ||
        !!pending ||
        !!intentError}
      loading={manualSaving}
      onclick={submitManualEntry}>Comptabiliser l’écriture</Button
    >
  {/snippet}
</Drawer>
