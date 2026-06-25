<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import {
    PageHeader,
    Card,
    Badge,
    EmptyState,
    Skeleton,
    ErrorNotice,
    type Tone,
  } from '$lib/components/ui';

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function money(val: string | number | null | undefined): string {
    if (val === null || val === undefined) return '—';
    const n = Number(val);
    if (isNaN(n)) return '—';
    return n.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function startOfYearIso(): string {
    return `${new Date().getFullYear()}-01-01`;
  }

  // ── Tabs ─────────────────────────────────────────────────────────────────────

  type Tab = 'pl' | 'bs' | 'cf' | 'ar' | 'ap';
  let activeTab = $state<Tab>('pl');

  // ── Date controls ─────────────────────────────────────────────────────────────

  /** P&L + Cash-flow range */
  let fromDate = $state(startOfYearIso());
  let toDate = $state(todayIso());

  /** Balance Sheet + Aging point-in-time */
  let asOf = $state(todayIso());

  // ── Types ─────────────────────────────────────────────────────────────────────

  interface ReportLine {
    code: string;
    name: string;
    amount: string;
  }

  interface ProfitAndLoss {
    revenue: ReportLine[];
    totalRevenue: string;
    expense: ReportLine[];
    totalExpense: string;
    netIncome: string;
  }

  interface BalanceSheetLine {
    code: string;
    name: string;
    amount: string;
  }

  interface BalanceSheet {
    assets: BalanceSheetLine[];
    totalAssets: string;
    liabilities: BalanceSheetLine[];
    totalLiabilities: string;
    equity: BalanceSheetLine[];
    totalEquity: string;
    netIncome: string;
    balanced: boolean;
  }

  interface CashFlowLine {
    code: string;
    name: string;
    amount: string;
  }

  interface CashFlow {
    accounts: CashFlowLine[];
    netChange: string;
  }

  interface AgingRow {
    partyId: string;
    partyName: string;
    buckets: Record<'0-30' | '31-60' | '61-90' | '91-120' | '120+', string>;
    total: string;
  }

  interface AgingReport {
    rows: AgingRow[];
    totals: Record<'0-30' | '31-60' | '61-90' | '91-120' | '120+', string>;
    grandTotal: string;
  }

  // ── State ─────────────────────────────────────────────────────────────────────

  let loadingPl = $state(false);
  let loadingBs = $state(false);
  let loadingCf = $state(false);
  let loadingAr = $state(false);
  let loadingAp = $state(false);

  let errorPl = $state('');
  let errorBs = $state('');
  let errorCf = $state('');
  let errorAr = $state('');
  let errorAp = $state('');

  let pl = $state<ProfitAndLoss | null>(null);
  let bs = $state<BalanceSheet | null>(null);
  let cf = $state<CashFlow | null>(null);
  let ar = $state<AgingReport | null>(null);
  let ap = $state<AgingReport | null>(null);

  // ── Load functions ────────────────────────────────────────────────────────────

  async function loadPl() {
    loadingPl = true;
    errorPl = '';
    try {
      pl = await api<ProfitAndLoss>('/billing/reports/profit-and-loss', {
        query: { from: fromDate, to: toDate },
      });
    } catch (e) {
      errorPl = e instanceof ApiError ? e.message : 'Échec du chargement des P&P';
    } finally {
      loadingPl = false;
    }
  }

  async function loadBs() {
    loadingBs = true;
    errorBs = '';
    try {
      bs = await api<BalanceSheet>('/billing/reports/balance-sheet', {
        query: { asOf },
      });
    } catch (e) {
      errorBs = e instanceof ApiError ? e.message : 'Échec du chargement du bilan';
    } finally {
      loadingBs = false;
    }
  }

  async function loadCf() {
    loadingCf = true;
    errorCf = '';
    try {
      cf = await api<CashFlow>('/billing/reports/cash-flow', {
        query: { from: fromDate, to: toDate },
      });
    } catch (e) {
      errorCf = e instanceof ApiError ? e.message : 'Échec du chargement des flux de trésorerie';
    } finally {
      loadingCf = false;
    }
  }

  async function loadAr() {
    loadingAr = true;
    errorAr = '';
    try {
      ar = await api<AgingReport>('/billing/reports/ar-aging', {
        query: { asOf },
      });
    } catch (e) {
      errorAr = e instanceof ApiError ? e.message : 'Échec du chargement de l\'âgé clients';
    } finally {
      loadingAr = false;
    }
  }

  async function loadAp() {
    loadingAp = true;
    errorAp = '';
    try {
      ap = await api<AgingReport>('/billing/reports/ap-aging', {
        query: { asOf },
      });
    } catch (e) {
      errorAp = e instanceof ApiError ? e.message : 'Échec du chargement de l\'âgé fournisseurs';
    } finally {
      loadingAp = false;
    }
  }

  // ── Reactive loads ────────────────────────────────────────────────────────────

  // When the range dates change, invalidate all range-based caches (pl, cf) so
  // inactive tabs are forced to reload on next visit, then immediately reload the
  // active tab if it belongs to this group.
  $effect(() => {
    void fromDate;
    void toDate;
    pl = null;
    cf = null;
    if (activeTab === 'pl') void loadPl();
    else if (activeTab === 'cf') void loadCf();
  });

  // When the point-in-time date changes, invalidate all asOf-based caches (bs,
  // ar, ap) so inactive tabs are forced to reload on next visit, then immediately
  // reload the active tab if it belongs to this group.
  $effect(() => {
    void asOf;
    bs = null;
    ar = null;
    ap = null;
    if (activeTab === 'bs') void loadBs();
    else if (activeTab === 'ar') void loadAr();
    else if (activeTab === 'ap') void loadAp();
  });

  // Load when switching tabs (if not yet loaded — caches are null after a date
  // change, so this also handles the "return to stale tab" case).
  $effect(() => {
    const tab = activeTab;
    if (tab === 'pl' && !pl && !loadingPl) void loadPl();
    else if (tab === 'bs' && !bs && !loadingBs) void loadBs();
    else if (tab === 'cf' && !cf && !loadingCf) void loadCf();
    else if (tab === 'ar' && !ar && !loadingAr) void loadAr();
    else if (tab === 'ap' && !ap && !loadingAp) void loadAp();
  });

  // ── Derived ───────────────────────────────────────────────────────────────────

  const bsBalancedTone = $derived<Tone>(bs?.balanced ? 'ok' : 'danger');

  // ── Tab helpers ───────────────────────────────────────────────────────────────

  function tabClass(t: Tab): string {
    return `rounded-lg px-4 py-2 text-sm font-medium transition ${
      activeTab === t ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
    }`;
  }

  function setTab(t: Tab) {
    activeTab = t;
  }
</script>

<PageHeader
  title="Rapports financiers"
  subtitle="Pertes & Profits, Bilan, Flux de trésorerie et âgé créances/dettes."
/>

<!-- Tabs -->
<div class="mb-6 flex flex-wrap gap-1 rounded-xl bg-surface-muted p-1 w-fit">
  <button class={tabClass('pl')} onclick={() => setTab('pl')}>Pertes &amp; Profits</button>
  <button class={tabClass('bs')} onclick={() => setTab('bs')}>Bilan</button>
  <button class={tabClass('cf')} onclick={() => setTab('cf')}>Flux de trésorerie</button>
  <button class={tabClass('ar')} onclick={() => setTab('ar')}>Âgé clients (AR)</button>
  <button class={tabClass('ap')} onclick={() => setTab('ap')}>Âgé fournisseurs (AP)</button>
</div>

<!-- ── Date controls ─────────────────────────────────────────────────────────── -->
{#if activeTab === 'pl' || activeTab === 'cf'}
  <div class="mb-5 flex flex-wrap items-center gap-4">
    <div class="flex items-center gap-2">
      <label class="text-sm font-medium text-ink" for="from-date">Du</label>
      <input
        id="from-date"
        type="date"
        bind:value={fromDate}
        class="rounded-lg border border-edge px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      />
    </div>
    <div class="flex items-center gap-2">
      <label class="text-sm font-medium text-ink" for="to-date">Au</label>
      <input
        id="to-date"
        type="date"
        bind:value={toDate}
        class="rounded-lg border border-edge px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      />
    </div>
  </div>
{/if}

{#if activeTab === 'bs' || activeTab === 'ar' || activeTab === 'ap'}
  <div class="mb-5 flex items-center gap-3">
    <label class="text-sm font-medium text-ink" for="asof-date">Au</label>
    <input
      id="asof-date"
      type="date"
      bind:value={asOf}
      class="rounded-lg border border-edge px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
    />
  </div>
{/if}

<!-- ── Pertes & Profits ───────────────────────────────────────────────────────── -->
{#if activeTab === 'pl'}
  <ErrorNotice message={errorPl} onretry={loadPl} />
  {#if loadingPl}
    <Card padded={false}><Skeleton rows={10} /></Card>
  {:else if pl}
    <div class="space-y-4">
      <!-- Revenus -->
      <Card padded={false}>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-edge text-xs font-semibold tracking-wide text-ink-faint uppercase">
                <th class="px-4 py-3 text-left">Code</th>
                <th class="px-4 py-3 text-left">Compte</th>
                <th class="px-4 py-3 text-right">Montant</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-edge-soft">
              <tr class="bg-surface-muted/40">
                <td class="px-4 py-2 text-xs font-bold uppercase text-ink-faint" colspan={3}>Revenus</td>
              </tr>
              {#each pl.revenue as row (row.code)}
                <tr class="text-sm hover:bg-surface-muted/50">
                  <td class="px-4 py-2.5 font-mono text-ink-muted">{row.code}</td>
                  <td class="px-4 py-2.5">{row.name}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums">{money(row.amount)}</td>
                </tr>
              {:else}
                <tr>
                  <td colspan={3} class="px-4 py-4 text-sm text-ink-faint text-center">Aucun revenu pour la période.</td>
                </tr>
              {/each}
            </tbody>
            <tfoot class="border-t border-edge">
              <tr class="text-sm font-bold">
                <td class="px-4 py-3" colspan={2}>Total revenus</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(pl.totalRevenue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <!-- Charges -->
      <Card padded={false}>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-edge text-xs font-semibold tracking-wide text-ink-faint uppercase">
                <th class="px-4 py-3 text-left">Code</th>
                <th class="px-4 py-3 text-left">Compte</th>
                <th class="px-4 py-3 text-right">Montant</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-edge-soft">
              <tr class="bg-surface-muted/40">
                <td class="px-4 py-2 text-xs font-bold uppercase text-ink-faint" colspan={3}>Charges</td>
              </tr>
              {#each pl.expense as row (row.code)}
                <tr class="text-sm hover:bg-surface-muted/50">
                  <td class="px-4 py-2.5 font-mono text-ink-muted">{row.code}</td>
                  <td class="px-4 py-2.5">{row.name}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums">{money(row.amount)}</td>
                </tr>
              {:else}
                <tr>
                  <td colspan={3} class="px-4 py-4 text-sm text-ink-faint text-center">Aucune charge pour la période.</td>
                </tr>
              {/each}
            </tbody>
            <tfoot class="border-t border-edge">
              <tr class="text-sm font-bold">
                <td class="px-4 py-3" colspan={2}>Total charges</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(pl.totalExpense)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <!-- Résultat net -->
      <Card>
        <div class="flex items-center justify-between">
          <span class="text-base font-bold text-ink">Résultat net</span>
          <span class="text-xl font-bold tabular-nums {Number(pl.netIncome) >= 0 ? 'text-ok' : 'text-danger'}">
            {money(pl.netIncome)}
          </span>
        </div>
      </Card>
    </div>
  {:else}
    <Card>
      <EmptyState title="Aucune donnée" message="Aucune donnée disponible pour la période sélectionnée." />
    </Card>
  {/if}
{/if}

<!-- ── Bilan ──────────────────────────────────────────────────────────────────── -->
{#if activeTab === 'bs'}
  <ErrorNotice message={errorBs} onretry={loadBs} />
  {#if loadingBs}
    <Card padded={false}><Skeleton rows={12} /></Card>
  {:else if bs}
    <div class="space-y-4">
      <!-- Actifs -->
      <Card padded={false}>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-edge text-xs font-semibold tracking-wide text-ink-faint uppercase">
                <th class="px-4 py-3 text-left">Code</th>
                <th class="px-4 py-3 text-left">Compte</th>
                <th class="px-4 py-3 text-right">Montant</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-edge-soft">
              <tr class="bg-surface-muted/40">
                <td class="px-4 py-2 text-xs font-bold uppercase text-ink-faint" colspan={3}>Actifs</td>
              </tr>
              {#each bs.assets as row (row.code)}
                <tr class="text-sm hover:bg-surface-muted/50">
                  <td class="px-4 py-2.5 font-mono text-ink-muted">{row.code}</td>
                  <td class="px-4 py-2.5">{row.name}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums">{money(row.amount)}</td>
                </tr>
              {:else}
                <tr>
                  <td colspan={3} class="px-4 py-4 text-sm text-ink-faint text-center">Aucun actif.</td>
                </tr>
              {/each}
            </tbody>
            <tfoot class="border-t border-edge">
              <tr class="text-sm font-bold">
                <td class="px-4 py-3" colspan={2}>Total actifs</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(bs.totalAssets)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <!-- Passifs -->
      <Card padded={false}>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-edge text-xs font-semibold tracking-wide text-ink-faint uppercase">
                <th class="px-4 py-3 text-left">Code</th>
                <th class="px-4 py-3 text-left">Compte</th>
                <th class="px-4 py-3 text-right">Montant</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-edge-soft">
              <tr class="bg-surface-muted/40">
                <td class="px-4 py-2 text-xs font-bold uppercase text-ink-faint" colspan={3}>Passifs</td>
              </tr>
              {#each bs.liabilities as row (row.code)}
                <tr class="text-sm hover:bg-surface-muted/50">
                  <td class="px-4 py-2.5 font-mono text-ink-muted">{row.code}</td>
                  <td class="px-4 py-2.5">{row.name}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums">{money(row.amount)}</td>
                </tr>
              {:else}
                <tr>
                  <td colspan={3} class="px-4 py-4 text-sm text-ink-faint text-center">Aucun passif.</td>
                </tr>
              {/each}
            </tbody>
            <tfoot class="border-t border-edge">
              <tr class="text-sm font-bold">
                <td class="px-4 py-3" colspan={2}>Total passifs</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(bs.totalLiabilities)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <!-- Capitaux propres -->
      <Card padded={false}>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-edge text-xs font-semibold tracking-wide text-ink-faint uppercase">
                <th class="px-4 py-3 text-left">Code</th>
                <th class="px-4 py-3 text-left">Compte</th>
                <th class="px-4 py-3 text-right">Montant</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-edge-soft">
              <tr class="bg-surface-muted/40">
                <td class="px-4 py-2 text-xs font-bold uppercase text-ink-faint" colspan={3}>Capitaux propres</td>
              </tr>
              {#each bs.equity as row (row.code)}
                <tr class="text-sm hover:bg-surface-muted/50">
                  <td class="px-4 py-2.5 font-mono text-ink-muted">{row.code}</td>
                  <td class="px-4 py-2.5">{row.name}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums">{money(row.amount)}</td>
                </tr>
              {:else}
                <tr>
                  <td colspan={3} class="px-4 py-4 text-sm text-ink-faint text-center">Aucun capital.</td>
                </tr>
              {/each}
              <tr class="text-sm text-ink-muted">
                <td class="px-4 py-2.5 font-mono">—</td>
                <td class="px-4 py-2.5 italic">Résultat de l'exercice</td>
                <td class="px-4 py-2.5 text-right tabular-nums">{money(bs.netIncome)}</td>
              </tr>
            </tbody>
            <tfoot class="border-t border-edge">
              <tr class="text-sm font-bold">
                <td class="px-4 py-3" colspan={2}>Total capitaux</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(bs.totalEquity)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <!-- Équilibre -->
      <Card>
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-ink">
            Actifs = Passifs + Capitaux : {money(bs.totalAssets)} = {money(Number(bs.totalLiabilities) + Number(bs.totalEquity) + Number(bs.netIncome))}
          </span>
          <Badge tone={bsBalancedTone}>
            {bs.balanced ? 'Équilibré' : 'Déséquilibré'}
          </Badge>
        </div>
      </Card>
    </div>
  {:else}
    <Card>
      <EmptyState title="Aucune donnée" message="Aucune donnée disponible pour la date sélectionnée." />
    </Card>
  {/if}
{/if}

<!-- ── Flux de trésorerie ──────────────────────────────────────────────────────── -->
{#if activeTab === 'cf'}
  <ErrorNotice message={errorCf} onretry={loadCf} />
  {#if loadingCf}
    <Card padded={false}><Skeleton rows={8} /></Card>
  {:else if cf}
    <div class="space-y-4">
      <Card padded={false}>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-edge text-xs font-semibold tracking-wide text-ink-faint uppercase">
                <th class="px-4 py-3 text-left">Code</th>
                <th class="px-4 py-3 text-left">Compte</th>
                <th class="px-4 py-3 text-right">Montant</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-edge-soft">
              {#each cf.accounts as row (row.code)}
                <tr class="text-sm hover:bg-surface-muted/50">
                  <td class="px-4 py-2.5 font-mono text-ink-muted">{row.code}</td>
                  <td class="px-4 py-2.5">{row.name}</td>
                  <td class="px-4 py-2.5 text-right tabular-nums">{money(row.amount)}</td>
                </tr>
              {:else}
                <tr>
                  <td colspan={3} class="px-4 py-4 text-sm text-ink-faint text-center">Aucune donnée pour la période.</td>
                </tr>
              {/each}
            </tbody>
            <tfoot class="border-t-2 border-edge">
              <tr class="text-sm font-bold">
                <td class="px-4 py-3" colspan={2}>Variation nette de trésorerie</td>
                <td class="px-4 py-3 text-right tabular-nums {Number(cf.netChange) >= 0 ? 'text-ok' : 'text-danger'}">
                  {money(cf.netChange)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  {:else}
    <Card>
      <EmptyState title="Aucune donnée" message="Aucune donnée disponible pour la période sélectionnée." />
    </Card>
  {/if}
{/if}

<!-- ── Âgé clients (AR) ───────────────────────────────────────────────────────── -->
{#if activeTab === 'ar'}
  <ErrorNotice message={errorAr} onretry={loadAr} />
  {#if loadingAr}
    <Card padded={false}><Skeleton rows={8} /></Card>
  {:else if ar}
    <Card padded={false}>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-edge text-xs font-semibold tracking-wide text-ink-faint uppercase">
              <th class="px-4 py-3 text-left">Client</th>
              <th class="px-4 py-3 text-right">0–30 j</th>
              <th class="px-4 py-3 text-right">31–60 j</th>
              <th class="px-4 py-3 text-right">61–90 j</th>
              <th class="px-4 py-3 text-right">91–120 j</th>
              <th class="px-4 py-3 text-right">120+ j</th>
              <th class="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-edge-soft">
            {#each ar.rows as row (row.partyId)}
              <tr class="text-sm hover:bg-surface-muted/50">
                <td class="px-4 py-2.5 font-medium">{row.partyName}</td>
                <td class="px-4 py-2.5 text-right tabular-nums">{money(row.buckets['0-30'])}</td>
                <td class="px-4 py-2.5 text-right tabular-nums">{money(row.buckets['31-60'])}</td>
                <td class="px-4 py-2.5 text-right tabular-nums">{money(row.buckets['61-90'])}</td>
                <td class="px-4 py-2.5 text-right tabular-nums">{money(row.buckets['91-120'])}</td>
                <td class="px-4 py-2.5 text-right tabular-nums">{money(row.buckets['120+'])}</td>
                <td class="px-4 py-2.5 text-right tabular-nums font-semibold">{money(row.total)}</td>
              </tr>
            {:else}
              <tr>
                <td colspan={7} class="px-4 py-6">
                  <EmptyState title="Aucune créance" message="Aucun solde à recevoir pour cette date." />
                </td>
              </tr>
            {/each}
          </tbody>
          {#if ar.rows.length > 0}
            <tfoot class="border-t-2 border-edge">
              <tr class="text-sm font-bold bg-surface-muted/30">
                <td class="px-4 py-3">Total</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(ar.totals['0-30'])}</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(ar.totals['31-60'])}</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(ar.totals['61-90'])}</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(ar.totals['91-120'])}</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(ar.totals['120+'])}</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(ar.grandTotal)}</td>
              </tr>
            </tfoot>
          {/if}
        </table>
      </div>
    </Card>
  {:else}
    <Card>
      <EmptyState title="Aucune donnée" message="Aucune donnée disponible pour la date sélectionnée." />
    </Card>
  {/if}
{/if}

<!-- ── Âgé fournisseurs (AP) ──────────────────────────────────────────────────── -->
{#if activeTab === 'ap'}
  <ErrorNotice message={errorAp} onretry={loadAp} />
  {#if loadingAp}
    <Card padded={false}><Skeleton rows={8} /></Card>
  {:else if ap}
    <Card padded={false}>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-edge text-xs font-semibold tracking-wide text-ink-faint uppercase">
              <th class="px-4 py-3 text-left">Fournisseur</th>
              <th class="px-4 py-3 text-right">0–30 j</th>
              <th class="px-4 py-3 text-right">31–60 j</th>
              <th class="px-4 py-3 text-right">61–90 j</th>
              <th class="px-4 py-3 text-right">91–120 j</th>
              <th class="px-4 py-3 text-right">120+ j</th>
              <th class="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-edge-soft">
            {#each ap.rows as row (row.partyId)}
              <tr class="text-sm hover:bg-surface-muted/50">
                <td class="px-4 py-2.5 font-medium">{row.partyName}</td>
                <td class="px-4 py-2.5 text-right tabular-nums">{money(row.buckets['0-30'])}</td>
                <td class="px-4 py-2.5 text-right tabular-nums">{money(row.buckets['31-60'])}</td>
                <td class="px-4 py-2.5 text-right tabular-nums">{money(row.buckets['61-90'])}</td>
                <td class="px-4 py-2.5 text-right tabular-nums">{money(row.buckets['91-120'])}</td>
                <td class="px-4 py-2.5 text-right tabular-nums">{money(row.buckets['120+'])}</td>
                <td class="px-4 py-2.5 text-right tabular-nums font-semibold">{money(row.total)}</td>
              </tr>
            {:else}
              <tr>
                <td colspan={7} class="px-4 py-6">
                  <EmptyState title="Aucune dette" message="Aucun solde à payer pour cette date." />
                </td>
              </tr>
            {/each}
          </tbody>
          {#if ap.rows.length > 0}
            <tfoot class="border-t-2 border-edge">
              <tr class="text-sm font-bold bg-surface-muted/30">
                <td class="px-4 py-3">Total</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(ap.totals['0-30'])}</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(ap.totals['31-60'])}</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(ap.totals['61-90'])}</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(ap.totals['91-120'])}</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(ap.totals['120+'])}</td>
                <td class="px-4 py-3 text-right tabular-nums">{money(ap.grandTotal)}</td>
              </tr>
            </tfoot>
          {/if}
        </table>
      </div>
    </Card>
  {:else}
    <Card>
      <EmptyState title="Aucune donnée" message="Aucune donnée disponible pour la date sélectionnée." />
    </Card>
  {/if}
{/if}
