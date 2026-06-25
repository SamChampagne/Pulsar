<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import {
    PageHeader,
    Card,
    Table,
    Badge,
    EmptyState,
    Skeleton,
    ErrorNotice,
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
    id: string;
    date: string;
    memo: string | null;
    source: string | null;
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
  let activeTab = $state<Tab>('chart');

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
    const n = Number(val);
    if (isNaN(n)) return '—';
    return n.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString('fr-CA');
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
    trialBalance !== null &&
      Number(trialBalance.totalDebit) === Number(trialBalance.totalCredit),
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
    loadingJournal = true;
    errorJournal = '';
    try {
      const result = await api<Paginated<JournalEntry>>('/billing/ledger/journal', {
        query: { page: journalPage, pageSize: journalPageSize },
      });
      journalEntries = result.items;
      journalTotal = result.total;
    } catch (e) {
      errorJournal = e instanceof ApiError ? e.message : 'Échec du chargement du journal';
    } finally {
      loadingJournal = false;
    }
  }

  async function loadBalance() {
    loadingBalance = true;
    errorBalance = '';
    try {
      const query: Record<string, string | number> = {};
      if (asOf) query.asOf = asOf;
      trialBalance = await api<TrialBalance>('/billing/ledger/trial-balance', { query });
    } catch (e) {
      errorBalance = e instanceof ApiError ? e.message : 'Échec du chargement de la balance';
    } finally {
      loadingBalance = false;
    }
  }

  // ── Reactive loads ────────────────────────────────────────────────────────────

  $effect(() => {
    void loadChart();
  });

  $effect(() => {
    void loadJournal();
  });

  $effect(() => {
    void loadBalance();
  });

  function goJournalPage(p: number) {
    journalPage = p;
  }
</script>

<PageHeader
  title="Grand livre"
  subtitle="Plan comptable, journal des écritures et balance de vérification."
/>

<!-- Tabs -->
<div class="mb-6 flex gap-1 rounded-xl bg-surface-muted p-1 w-fit">
  <button
    class={`rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === 'chart' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}
    onclick={() => { activeTab = 'chart'; }}
  >Plan comptable</button>
  <button
    class={`rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === 'journal' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}
    onclick={() => { activeTab = 'journal'; }}
  >Journal</button>
  <button
    class={`rounded-lg px-4 py-2 text-sm font-medium transition ${activeTab === 'balance' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}
    onclick={() => { activeTab = 'balance'; }}
  >Balance</button>
</div>

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
  <ErrorNotice message={errorJournal} onretry={loadJournal} />
  {#if loadingJournal}
    <Card padded={false}><Skeleton rows={8} /></Card>
  {:else}
    <div class="space-y-3">
      {#each journalEntries as entry (entry.id)}
        <Card>
          <div class="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <span class="font-mono text-xs text-ink-faint">{fmtDate(entry.date)}</span>
              {#if entry.source}
                <span class="ml-2"><Badge tone="neutral">{entry.source}</Badge></span>
              {/if}
            </div>
            {#if entry.memo}
              <span class="text-sm text-ink-muted">{entry.memo}</span>
            {/if}
          </div>
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
        </Card>
      {:else}
        <Card>
          <EmptyState title="Aucune écriture" message="Le journal est vide pour cette période." />
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
            onclick={() => goJournalPage(journalPage - 1)}
          >‹ Préc.</button>
          <span class="px-2 py-1">{journalPage} / {totalPages}</span>
          <button
            class="rounded px-2 py-1 hover:bg-surface-muted disabled:opacity-40"
            disabled={journalPage >= totalPages}
            onclick={() => goJournalPage(journalPage + 1)}
          >Suiv. ›</button>
        </div>
      </div>
    {/if}
  {/if}
{/if}

<!-- ── Balance de vérification ────────────────────────────────────────────── -->
{#if activeTab === 'balance'}
  <div class="mb-4 flex items-center gap-3">
    <label class="text-sm font-medium text-ink" for="asof-input">Au</label>
    <input
      id="asof-input"
      type="date"
      bind:value={asOf}
      onchange={loadBalance}
      class="rounded-lg border border-edge px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
    />
    <span class="text-xs text-ink-faint">(laisser vide pour la date courante)</span>
  </div>

  <ErrorNotice message={errorBalance} onretry={loadBalance} />

  {#if loadingBalance}
    <Card padded={false}><Skeleton rows={8} /></Card>
  {:else if trialBalance}
    <Card padded={false}>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-edge text-xs font-semibold tracking-wide text-ink-faint uppercase">
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
                <td class="px-4 py-2.5 text-right tabular-nums font-semibold">{money(row.balance)}</td>
              </tr>
            {:else}
              <tr>
                <td colspan={6} class="px-4 py-6">
                  <EmptyState title="Aucun solde" message="Aucune donnée disponible pour cette période." />
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
                  <Badge tone="ok">Équilibré ✓</Badge>
                {:else}
                  <Badge tone="danger">Déséquilibré !</Badge>
                {/if}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  {:else}
    <Card>
      <EmptyState title="Aucune balance" message="Impossible de charger la balance de vérification." />
    </Card>
  {/if}
{/if}
