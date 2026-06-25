# Finance — Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Annual per-account budgets + budget-vs-actual variance computed read-time from the ledger. No GL writes.

**Architecture:** `Budget` + `BudgetLine` masters; pure `computeBudgetVariance` in `@pulsar/shared`; `BudgetsService` aggregates `JournalLine` over the fiscal year per budgeted account (reuses `naturalBalance`) for the variance endpoint. Reuses `billing.ledger.read|manage`.

**Tech Stack:** NestJS, Prisma, SvelteKit Svelte-5, `@pulsar/shared`, Vitest, Jest+supertest.

## Global Constraints
- Tenant isolation (rule 1) from `@CurrentUser()`.
- `@RequireModule(MODULE_KEYS.BILLING)` + `billing.ledger.read` (reads) / `billing.ledger.manage` (writes) — NO new permission.
- FK validated (rule 9); ownership check before mutate.
- NO GL writes (variance is read-only; reuse `naturalBalance` from `@pulsar/shared`).
- Money `Decimal @db.Decimal(12,2)`, Number at boundary, round2. Rebuild shared+database after schema/shared changes (rule 7).
- Web: align local types to the REAL API DTO shape + grep for stale field names (typecheck does NOT catch mismatches); valid Tone union; verify `pnpm --filter @pulsar/web typecheck`.

---

### Task 1: Shared — computeBudgetVariance

**Files:** Create `packages/shared/src/billing/budget.ts` + `budget.spec.ts`; modify `index.ts`.

- [ ] **Step 1: Failing test**
```ts
// packages/shared/src/billing/budget.spec.ts
import { describe, it, expect } from 'vitest';
import { computeBudgetVariance } from './budget';
describe('computeBudgetVariance', () => {
  it('variance = budget − actual, with pct and totals', () => {
    const r = computeBudgetVariance([
      { accountCode: '5000', name: 'Charges', budget: 1000, actual: 800 },
      { accountCode: '4000', name: 'Revenus', budget: 5000, actual: 6000 },
    ]);
    expect(r.rows[0]).toEqual({ accountCode: '5000', name: 'Charges', budget: 1000, actual: 800, variance: 200, variancePct: 20 });
    expect(r.rows[1].variance).toBe(-1000);
    expect(r.rows[1].variancePct).toBe(-20);
    expect(r.totalBudget).toBe(6000);
    expect(r.totalActual).toBe(6800);
    expect(r.totalVariance).toBe(-800);
  });
  it('budget 0 → variancePct 0', () => {
    const r = computeBudgetVariance([{ accountCode: '5000', name: 'X', budget: 0, actual: 50 }]);
    expect(r.rows[0].variancePct).toBe(0);
    expect(r.rows[0].variance).toBe(-50);
  });
});
```
- [ ] **Step 2: RED** — `pnpm --filter @pulsar/shared test -- budget`.
- [ ] **Step 3: Implement**
```ts
// packages/shared/src/billing/budget.ts
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export interface BudgetVarianceInput { accountCode: string; name: string; budget: number; actual: number }
export interface BudgetVarianceRow { accountCode: string; name: string; budget: number; actual: number; variance: number; variancePct: number }
export function computeBudgetVariance(inputs: BudgetVarianceInput[]): { rows: BudgetVarianceRow[]; totalBudget: number; totalActual: number; totalVariance: number } {
  const rows = inputs.map((i) => {
    const variance = round2(i.budget - i.actual);
    const variancePct = i.budget !== 0 ? round2((variance / Math.abs(i.budget)) * 100) : 0;
    return { accountCode: i.accountCode, name: i.name, budget: round2(i.budget), actual: round2(i.actual), variance, variancePct };
  });
  const totalBudget = round2(rows.reduce((s, r) => s + r.budget, 0));
  const totalActual = round2(rows.reduce((s, r) => s + r.actual, 0));
  return { rows, totalBudget, totalActual, totalVariance: round2(totalBudget - totalActual) };
}
```
- [ ] **Step 4: Re-export** `export * from './billing/budget';` in `index.ts`.
- [ ] **Step 5: GREEN + build.** **Step 6: Commit** `feat(shared): computeBudgetVariance helper`

---

### Task 2: Database — Budget + BudgetLine

**Files:** `schema.prisma` + migration.
- [ ] **Step 1:** Add `Budget` + `BudgetLine` models verbatim from the spec (Decimal(12,2) amount, cascade line→budget, `@@unique([tenantId,name,fiscalYear])`, indexes, `@@map`).
- [ ] **Step 2:** Add `budgets Budget[]` to `model Tenant`.
- [ ] **Step 3:** `pnpm db:up` then `pnpm db:migrate -- --name finance_budget` (additive). `pnpm --filter @pulsar/database build`.
- [ ] **Step 4: Commit** `feat(db): Budget/BudgetLine` (touch only schema + migration; no unrelated git add).

---

### Task 3: API — BudgetsService + controller

**Files:** Create `apps/api/src/modules/billing/budgets/budgets.service.ts`, `budgets.controller.ts`, `dto/budget.dto.ts`; modify `billing.module.ts`.

- [ ] **Step 1: DTO** — `BudgetLineDto { @IsString @Matches(/^[0-9A-Z]{1,10}$/) accountCode; @IsNumber amount }`; `CreateBudgetDto { @IsString @Length(1,80) name; @IsInt @Min(2000) @Max(2100) fiscalYear; @IsOptional @IsBoolean isActive?; @IsArray @ValidateNested({each:true}) @Type(()=>BudgetLineDto) lines }`; `UpdateBudgetDto extends PartialType`.
- [ ] **Step 2: Service** (inject PrismaService) — tenant-scoped CRUD; on update with `lines`, replace lines (deleteMany by budgetId + createMany). update/remove guard `findFirst({id,tenantId})` first.
  - `variance(tenantId, id)`: load budget+lines (404). For the fiscal year, compute `from = new Date(Date.UTC(fy,0,1))`, `to = new Date(Date.UTC(fy,11,31,23,59,59,999))`. Aggregate `journalLine.findMany({ where: { tenantId, account: { code: { in: lineCodes } }, entry: { date: { gte: from, lte: to } } }, select: { debit, credit, account: { select: { code, name, type } } } })`, group by account code (Number, round2 debit/credit), compute `naturalBalance({code,name,type,debit,credit})` (import from `@pulsar/shared`). Build `BudgetVarianceInput[]` (one per budget line; name from the account or '—' if no GL activity; actual 0 if account has no lines). Return `computeBudgetVariance(inputs)`.
- [ ] **Step 3: Controller** — `@Controller('billing/budgets')`, `@RequireModule(MODULE_KEYS.BILLING)`; `GET` list/`:id`/`:id/variance` → `LEDGER_READ`; `POST`/`PATCH :id`/`DELETE :id` → `LEDGER_MANAGE`. `:id/variance` before `:id`.
- [ ] **Step 4: Wire BillingModule** (controller + service). Verify typecheck + build (0). **Commit** `feat(api): budgets CRUD + variance`

---

### Task 4: API — budgets e2e

**Files:** Create `apps/api/test/budgets.e2e-spec.ts`. Mirror billing-ledger e2e bootstrap.
- [ ] **Step 1:** Cover: create budget (current fiscalYear, line accountCode '5000' budget 1000); create+approve a carrier invoice (posts DR 5000 expense via ledgerAutoPost) of e.g. 300; `GET :id/variance` → row for 5000 with actual≈300, budget 1000, variance≈700; budget 0 line → pct 0; tenant isolation 404. Concrete assertions; unique codes.
- [ ] **Step 2:** `pnpm --filter @pulsar/api test:e2e -- budgets` all pass. **Commit** `test(api): budgets variance e2e`

---

### Task 5: Web — budgets page + nav

**Files:** Create `apps/web/src/routes/(app)/billing/budgets/+page.svelte`; modify `navigation.ts`.
- [ ] **Step 1:** List budgets (name, fiscalYear, isActive badge, total budgeted); create/edit modal (name, fiscalYear, repeatable lines accountCode+amount); a variance view per budget (`GET :id/variance` → table account/budget/actual/variance/variancePct, tone: variance<0 → danger else ok, totals row). Align local types to the variance DTO (`rows[].{accountCode,name,budget,actual,variance,variancePct}`, totalBudget/totalActual/totalVariance) + grep. Number-coerce. Valid tones.
- [ ] **Step 2:** Nav `{ href: '/billing/budgets', label: 'Budgets', perm: PERMISSIONS.BILLING.LEDGER_READ }` after "Banque".
- [ ] **Step 3:** `pnpm --filter @pulsar/web typecheck` 0 errors. **Commit** `feat(web): budgets page + variance + nav`

---

### Task 6: Final verification + docs
- [ ] **Step 1:** `pnpm typecheck` (0), `pnpm test` (shared incl budget.spec).
- [ ] **Step 2:** `pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm --filter @pulsar/api test:e2e` — full suite. Additive + read-only → no regression expected; confirm pre-existing flakes (wms-fulfillment) in isolation.
- [ ] **Step 3:** Docs: CLAUDE.md "Hard rules (continued)" entry **46** for Budget (annual per-account budgets; variance computed read-time from JournalLine via pure `computeBudgetVariance` + `naturalBalance`; NO GL write; `billing.ledger.read|manage`). `docs/etat-du-projet.md` note. Keep claims accurate (no idempotency/feature the code lacks).
- [ ] **Step 4:** Commit fixups + docs.

---
## Self-Review notes (author)
- Coverage: helper (T1), models (T2), service+variance (T3), e2e (T4), web (T5), verify+docs (T6).
- Read-mostly, low risk (no GL writes). Main surface = the variance GL aggregation over the fiscal-year window + naturalBalance reuse.
- Type consistency: `computeBudgetVariance`/`BudgetVarianceInput` (T1) consumed in T3; `naturalBalance` (shared) reused in T3.
