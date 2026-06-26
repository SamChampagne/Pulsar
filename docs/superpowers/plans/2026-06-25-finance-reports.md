# Finance — Financial Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add read-time financial statements (P&L, Balance Sheet, Cash Flow, AR aging, AP aging) computed from the ledger (`JournalLine`) and invoices — no migration, no store, no mutation.

**Architecture:** Pure classification/aggregation helpers in `@pulsar/shared`; a `FinancialReportsService` that aggregates `JournalLine` by account over date ranges (reusing the trial-balance aggregation idiom) and buckets open invoices for aging; a `ReportsController` exposing read endpoints gated by the existing `billing.ledger.read`; a tabbed `/billing/reports` web page.

**Tech Stack:** NestJS, Prisma (`@pulsar/database`), SvelteKit Svelte-5 SPA, `@pulsar/shared`, Vitest (shared unit), Jest+supertest (api e2e seeded DB).

## Global Constraints
- Tenant isolation (rule 1): every query filtered by `tenantId` from `@CurrentUser()`.
- `@RequireModule(MODULE_KEYS.BILLING)` + `@RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ)` on every endpoint (rule 5). NO new permission key.
- Read-only: NO writes to the ledger or invoices (rule 41 — reports never post).
- Reuse `normalBalance`/`AccountType` from `@pulsar/shared` — never reimplement.
- No migration, no rollup store (compute at read, like trial balance + Control Tower).
- Money: `round2` at the boundary; Prisma `Decimal` → `Number` only at aggregation.
- Dates: normalize `to`/`asOf` to end-of-day (mirror `LedgerService.trialBalance`).
- Web: `$state`+`$effect`+`api<T>()`, `$lib/components/ui`, valid Tone union only, Decimal-string coercion. Verify web with `pnpm --filter @pulsar/web typecheck` (svelte-check).
- Rebuild shared after changing it: `pnpm --filter @pulsar/shared build`.

---

### Task 1: Shared — pure report helpers

**Files:**
- Create: `packages/shared/src/billing/reports.ts`
- Create: `packages/shared/src/billing/reports.spec.ts`
- Modify: `packages/shared/src/index.ts` (re-export `./billing/reports`)

**Interfaces produced:** `naturalBalance`, `buildProfitAndLoss`, `buildBalanceSheet`, `bucketForAge`, `buildAging` + the interfaces from the spec.

- [ ] **Step 1: Failing test**

```ts
// packages/shared/src/billing/reports.spec.ts
import { describe, it, expect } from 'vitest';
import { AccountType } from './ledger';
import { naturalBalance, buildProfitAndLoss, buildBalanceSheet, bucketForAge, buildAging } from './reports';

describe('naturalBalance', () => {
  it('debit-normal (asset/expense) = debit − credit', () => {
    expect(naturalBalance({ code: '1000', name: 'Cash', type: AccountType.ASSET, debit: 100, credit: 30 })).toBe(70);
  });
  it('credit-normal (liability/revenue/equity) = credit − debit', () => {
    expect(naturalBalance({ code: '4000', name: 'Rev', type: AccountType.REVENUE, debit: 10, credit: 110 })).toBe(100);
  });
});

describe('buildProfitAndLoss', () => {
  it('net income = revenue − expense', () => {
    const r = buildProfitAndLoss([
      { code: '4000', name: 'Rev', type: AccountType.REVENUE, debit: 0, credit: 100 },
      { code: '5000', name: 'Exp', type: AccountType.EXPENSE, debit: 40, credit: 0 },
      { code: '1000', name: 'Cash', type: AccountType.ASSET, debit: 100, credit: 0 }, // ignored in P&L
    ]);
    expect(r.totalRevenue).toBe(100);
    expect(r.totalExpense).toBe(40);
    expect(r.netIncome).toBe(60);
    expect(r.revenue).toHaveLength(1);
    expect(r.expense).toHaveLength(1);
  });
});

describe('buildBalanceSheet', () => {
  it('balanced when assets = liabilities + equity + netIncome', () => {
    const r = buildBalanceSheet([
      { code: '1000', name: 'Cash', type: AccountType.ASSET, debit: 160, credit: 0 },
      { code: '2000', name: 'AP', type: AccountType.LIABILITY, debit: 0, credit: 100 },
      { code: '3000', name: 'Capital', type: AccountType.EQUITY, debit: 0, credit: 0 },
    ], 60);
    expect(r.totalAssets).toBe(160);
    expect(r.totalLiabilities).toBe(100);
    expect(r.totalEquity).toBe(0);
    expect(r.netIncome).toBe(60);
    expect(r.balanced).toBe(true);
  });
});

describe('bucketForAge', () => {
  it('boundaries', () => {
    expect(bucketForAge(0)).toBe('0-30');
    expect(bucketForAge(30)).toBe('0-30');
    expect(bucketForAge(31)).toBe('31-60');
    expect(bucketForAge(90)).toBe('61-90');
    expect(bucketForAge(121)).toBe('120+');
  });
});

describe('buildAging', () => {
  it('groups by party and buckets by age', () => {
    const asOf = new Date('2026-02-01T00:00:00Z');
    const r = buildAging([
      { partyId: 'c1', partyName: 'Acme', reference: 'INV-1', date: '2026-01-20', outstanding: 50 }, // 12d → 0-30
      { partyId: 'c1', partyName: 'Acme', reference: 'INV-2', date: '2025-12-01', outstanding: 30 }, // 62d → 61-90
    ], asOf);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].buckets['0-30']).toBe(50);
    expect(r.rows[0].buckets['61-90']).toBe(30);
    expect(r.rows[0].total).toBe(80);
    expect(r.grandTotal).toBe(80);
  });
});
```

- [ ] **Step 2: RED** — `pnpm --filter @pulsar/shared test -- reports` → FAIL (cannot resolve).

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/billing/reports.ts
import { AccountType, normalBalance } from './ledger';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface AccountBalanceInput { code: string; name: string; type: AccountType | string; debit: number; credit: number }
export interface ReportLine { code: string; name: string; amount: number }
export interface ProfitAndLoss { revenue: ReportLine[]; expense: ReportLine[]; totalRevenue: number; totalExpense: number; netIncome: number }
export interface BalanceSheet { assets: ReportLine[]; liabilities: ReportLine[]; equity: ReportLine[]; totalAssets: number; totalLiabilities: number; totalEquity: number; netIncome: number; balanced: boolean }

export function naturalBalance(input: AccountBalanceInput): number {
  const nb = normalBalance(input.type as AccountType);
  return round2(nb === 'DEBIT' ? input.debit - input.credit : input.credit - input.debit);
}

export function buildProfitAndLoss(rows: AccountBalanceInput[]): ProfitAndLoss {
  const revenue: ReportLine[] = [];
  const expense: ReportLine[] = [];
  for (const r of rows) {
    if (r.type === AccountType.REVENUE) revenue.push({ code: r.code, name: r.name, amount: naturalBalance(r) });
    else if (r.type === AccountType.EXPENSE) expense.push({ code: r.code, name: r.name, amount: naturalBalance(r) });
  }
  const totalRevenue = round2(revenue.reduce((s, l) => s + l.amount, 0));
  const totalExpense = round2(expense.reduce((s, l) => s + l.amount, 0));
  return { revenue, expense, totalRevenue, totalExpense, netIncome: round2(totalRevenue - totalExpense) };
}

export function buildBalanceSheet(rows: AccountBalanceInput[], netIncome: number): BalanceSheet {
  const assets: ReportLine[] = [];
  const liabilities: ReportLine[] = [];
  const equity: ReportLine[] = [];
  for (const r of rows) {
    const line = { code: r.code, name: r.name, amount: naturalBalance(r) };
    if (r.type === AccountType.ASSET) assets.push(line);
    else if (r.type === AccountType.LIABILITY) liabilities.push(line);
    else if (r.type === AccountType.EQUITY) equity.push(line);
  }
  const totalAssets = round2(assets.reduce((s, l) => s + l.amount, 0));
  const totalLiabilities = round2(liabilities.reduce((s, l) => s + l.amount, 0));
  const totalEquity = round2(equity.reduce((s, l) => s + l.amount, 0));
  const balanced = round2(totalAssets) === round2(totalLiabilities + totalEquity + netIncome);
  return { assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, netIncome: round2(netIncome), balanced };
}

export type AgingBucket = '0-30' | '31-60' | '61-90' | '91-120' | '120+';
export interface AgingItemInput { partyId: string; partyName: string; reference: string; date: string | Date; outstanding: number }
export interface AgingPartyRow { partyId: string; partyName: string; buckets: Record<AgingBucket, number>; total: number }
export interface AgingReport { rows: AgingPartyRow[]; totals: Record<AgingBucket, number>; grandTotal: number }

const BUCKETS: AgingBucket[] = ['0-30', '31-60', '61-90', '91-120', '120+'];
const emptyBuckets = (): Record<AgingBucket, number> => ({ '0-30': 0, '31-60': 0, '61-90': 0, '91-120': 0, '120+': 0 });

export function bucketForAge(days: number): AgingBucket {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  if (days <= 120) return '91-120';
  return '120+';
}

export function buildAging(items: AgingItemInput[], asOf: Date): AgingReport {
  const byParty = new Map<string, AgingPartyRow>();
  const totals = emptyBuckets();
  for (const it of items) {
    const d = new Date(it.date);
    const days = Math.floor((asOf.getTime() - d.getTime()) / 86400000);
    const bucket = bucketForAge(days < 0 ? 0 : days);
    let row = byParty.get(it.partyId);
    if (!row) { row = { partyId: it.partyId, partyName: it.partyName, buckets: emptyBuckets(), total: 0 }; byParty.set(it.partyId, row); }
    row.buckets[bucket] = round2(row.buckets[bucket] + it.outstanding);
    row.total = round2(row.total + it.outstanding);
    totals[bucket] = round2(totals[bucket] + it.outstanding);
  }
  const grandTotal = round2(BUCKETS.reduce((s, b) => s + totals[b], 0));
  return { rows: [...byParty.values()], totals, grandTotal };
}
```

- [ ] **Step 4: Re-export** — `export * from './billing/reports';` in `index.ts` (next to `./billing/tax`).
- [ ] **Step 5: GREEN + build** — `pnpm --filter @pulsar/shared test -- reports` (all pass) then `pnpm --filter @pulsar/shared build`.
- [ ] **Step 6: Commit**
```bash
git add packages/shared/src/billing/reports.ts packages/shared/src/billing/reports.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): financial report helpers (P&L, balance sheet, aging)"
```

---

### Task 2: API — FinancialReportsService (P&L, Balance Sheet, Cash Flow) + ReportsController

**Files:**
- Create: `apps/api/src/modules/billing/reports/financial-reports.service.ts`
- Create: `apps/api/src/modules/billing/reports/reports.controller.ts`
- Modify: `apps/api/src/modules/billing/billing.module.ts`

- [ ] **Step 1: Service — GL aggregation + report builders.** Add a private `aggregateByAccount(tenantId, { from?, to? })` that does `journalLine.findMany` (tenant-scoped, with `entry.date` `gte from` / `lte toEndOfDay`) grouped by account into `AccountBalanceInput[]` — mirror `LedgerService.trialBalance` (Decimal→Number, round2). Then:
  - `profitAndLoss(tenantId, from?, to?)` → `buildProfitAndLoss(aggregate(from,to))`.
  - `balanceSheet(tenantId, asOf?)` → assets/liab/equity from `aggregate(undefined, asOf)`; `netIncome` from `buildProfitAndLoss(aggregate(undefined, asOf)).netIncome` (cumulative to asOf); return `buildBalanceSheet(rows, netIncome)`.
  - `cashFlow(tenantId, from?, to?)` → resolve `cashAccountCode`/`bankAccountCode` via `ModuleSettingsService.resolve(tenantId,'billing')`; filter the aggregated rows to those codes; return `{ accounts: ReportLine[] (naturalBalance over the period), netChange }`.
  Inject `PrismaService` + `ModuleSettingsService`. Normalize `to`/`asOf` to end-of-day.

- [ ] **Step 2: Controller** — `@Controller('billing/reports')`, `@RequireModule(MODULE_KEYS.BILLING)`, every method `@RequirePermissions(PERMISSIONS.BILLING.LEDGER_READ)`:
  - `GET profit-and-loss?from=&to=`, `GET balance-sheet?asOf=`, `GET cash-flow?from=&to=`. Parse query dates to `Date` (undefined if absent).
- [ ] **Step 3: Wire BillingModule** — add `ReportsController` to controllers, `FinancialReportsService` to providers.
- [ ] **Step 4: Verify** — `pnpm --filter @pulsar/api typecheck` (0) + `pnpm --filter @pulsar/api build` (0).
- [ ] **Step 5: Commit**
```bash
git add apps/api/src/modules/billing/reports apps/api/src/modules/billing/billing.module.ts
git commit -m "feat(api): financial reports service (P&L, balance sheet, cash flow)"
```

---

### Task 3: API — AR/AP aging

**Files:** Modify `apps/api/src/modules/billing/reports/financial-reports.service.ts` + `reports.controller.ts`.

- [ ] **Step 1: Service** — add:
  - `arAging(tenantId, asOf)`: `customerInvoice.findMany` where `tenantId`, `status: { not: 'DRAFT' }`, then in JS keep those with `outstanding = Number(totalAmount) - Number(amountPaid) > 0`; map to `AgingItemInput` (`partyId: customerId`, `partyName: customer.name` via include, `reference: invoiceNumber`, `date: approvedAt ?? createdAt`, `outstanding`); return `buildAging(items, asOf)`.
  - `apAging(tenantId, asOf)`: same over `invoice` (carrier; `partyId: carrierId`, `partyName: carrier.name`).
- [ ] **Step 2: Controller** — `GET ar-aging?asOf=`, `GET ap-aging?asOf=` (both `LEDGER_READ`).
- [ ] **Step 3: Verify** — typecheck + build (0).
- [ ] **Step 4: Commit**
```bash
git add apps/api/src/modules/billing/reports
git commit -m "feat(api): AR/AP aging reports"
```

---

### Task 4: API — reports e2e

**Files:** Create `apps/api/test/reports.e2e-spec.ts`.

- [ ] **Step 1:** Mirror `billing-ledger.e2e-spec.ts` bootstrap. Seed activity (approve a customer invoice → AR/Revenue GL; optionally apply tax; record a payment → cash/AR). Then assert:
  - `GET /billing/reports/profit-and-loss?from=&to=` → `totalRevenue` reflects the approved invoice's net revenue, `netIncome = revenue − expense`.
  - `GET /billing/reports/balance-sheet?asOf=` → `balanced === true`; `totalAssets` includes AR/cash.
  - `GET /billing/reports/cash-flow?from=&to=` → cash account net change matches the payment.
  - `GET /billing/reports/ar-aging?asOf=` → an unpaid invoice appears in the right bucket for the right customer; grandTotal = its outstanding.
  - `GET /billing/reports/ap-aging?asOf=` → analogous for a carrier invoice.
  - Tenant isolation: second tenant sees none of the first tenant's figures (empty/zero).
- [ ] **Step 2:** `pnpm --filter @pulsar/api test:e2e -- reports` (DB up+seeded) — all pass. BLOCKED report if bootstrap impossible; never hollow.
- [ ] **Step 3: Commit**
```bash
git add apps/api/test/reports.e2e-spec.ts
git commit -m "test(api): financial reports e2e (P&L/BS/cash-flow/aging/isolation)"
```

---

### Task 5: Web — financial reports page + nav

**Files:** Create `apps/web/src/routes/(app)/billing/reports/+page.svelte`; modify `apps/web/src/lib/modules/navigation.ts`.

- [ ] **Step 1:** Tabbed page (P&L · Bilan · Flux de trésorerie · Âgé AR · Âgé AP). Date controls: from/to for P&L+cash-flow (default = start of current year → today), asOf for balance-sheet+aging (default today). Each tab fetches its endpoint, renders section tables (revenue/expense, asset/liab/equity, aging buckets per party) with totals; balance-sheet shows a "Équilibré" badge (valid Tone). `money()` Number-coercion on all Decimal-string amounts. Mirror `/billing/ledger/+page.svelte` tab idiom + `$lib/components/ui`.
- [ ] **Step 2:** Nav — add `{ href: '/billing/reports', label: 'Rapports financiers', perm: PERMISSIONS.BILLING.LEDGER_READ }` under the Finance/Billing domain in `navigation.ts` (after "Grand livre").
- [ ] **Step 3:** `pnpm --filter @pulsar/web typecheck` (0 errors).
- [ ] **Step 4: Commit**
```bash
git add "apps/web/src/routes/(app)/billing/reports/+page.svelte" apps/web/src/lib/modules/navigation.ts
git commit -m "feat(web): financial reports page (P&L/BS/cash-flow/aging) + nav"
```

---

### Task 6: Final verification + docs

- [ ] **Step 1:** `pnpm typecheck` (0), `pnpm test` (shared incl reports.spec green).
- [ ] **Step 2:** `pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm --filter @pulsar/api test:e2e` — full suite. Reports are read-only (no schema/data change), so NO regression expected; investigate any real break; confirm pre-existing flakes (e.g. wms-fulfillment) in isolation.
- [ ] **Step 3:** Docs: CLAUDE.md "Hard rules (continued)" entry **44** for Reports (financial statements computed at read-time from JournalLine via pure `@pulsar/shared` helpers; no store/migration; `LEDGER_READ` gated; `normalBalance` reused). Note in `docs/etat-du-projet.md`.
- [ ] **Step 4:** Commit fixups + docs.

---

## Self-Review notes (author)
- Coverage: helpers (T1), GL reports service+controller (T2), aging (T3), e2e (T4), web+nav (T5), verify+docs (T6). Customer/Supplier ledger + custom templates deferred.
- Read-only feature: lowest risk of the three — no migration, no mutation, no new permission. Main correctness surface = the pure helpers (well-tested in T1) and the date-range aggregation (mirror trial balance).
- Type consistency: `AccountBalanceInput`/`buildProfitAndLoss`/`buildBalanceSheet`/`buildAging` produced in T1, consumed in T2/T3; `aggregateByAccount` produced in T2 consumed in T2/T3.
