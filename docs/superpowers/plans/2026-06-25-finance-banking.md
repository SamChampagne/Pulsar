# Finance — Banque Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Bank accounts + bank transactions (manual + CSV import) + reconciliation matching bank lines to payments — a clearing sub-ledger, no new GL postings.

**Architecture:** `BankAccount` + `BankTransaction` masters in the billing module; pure CSV/format helpers in `@pulsar/shared`; reconciliation matches a bank transaction 1:1 to a payment (whose mode-of-payment GL account == the bank account's `glAccountCode`), flagging both reconciled. Reuses `billing.ledger.read|manage` permissions. No GL writes.

**Tech Stack:** NestJS, Prisma (`@pulsar/database`), SvelteKit Svelte-5 SPA, `@pulsar/shared`, Vitest, Jest+supertest.

## Global Constraints
- Tenant isolation (rule 1) from `@CurrentUser()`.
- Enum mirror shared↔Prisma (rule 3); rebuild shared+database after (rule 7).
- `@RequireModule(MODULE_KEYS.BILLING)` + `billing.ledger.read` (reads) / `billing.ledger.manage` (writes) — NO new permission.
- Audit match/unmatch (rule 6); FK validated (rule 9); claim conditional `updateMany` for status flips (rule 2 pattern, TOCTOU).
- NO GL writes from this module (reconciliation is clearing; GL stays driven by Payments — rule 41). `Payment.reconciledAt` never alters status/amountPaid.
- Money: `Decimal @db.Decimal(12,2)`, Number at boundary, round2.
- Web: `$state`+`$effect`+`api<T>()`, `$lib/components/ui`, valid Tone union only, Decimal-string coercion; verify `pnpm --filter @pulsar/web typecheck` (svelte-check). **Web pages: align local types to the REAL API return shape and grep for stale field names — typecheck alone does not catch DTO mismatches.**

---

### Task 1: Shared — banking helpers + enum

**Files:** Create `packages/shared/src/billing/banking.ts` + `banking.spec.ts`; modify `index.ts`.
**Produces:** `enum BankTxnStatus { UNRECONCILED, RECONCILED }`, `parseBankCsv`, `maskAccountNumber`, `bankBalance`, `CsvBankRow`.

- [ ] **Step 1: Failing test**
```ts
// packages/shared/src/billing/banking.spec.ts
import { describe, it, expect } from 'vitest';
import { parseBankCsv, maskAccountNumber, bankBalance, BankTxnStatus } from './banking';

describe('parseBankCsv', () => {
  it('parses header + comma rows', () => {
    const r = parseBankCsv('date,description,amount,reference\n2026-01-05,Depot,100.50,REF1\n2026-01-06,Frais,-12.00,');
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { date: '2026-01-05', description: 'Depot', amount: 100.5, reference: 'REF1' },
      { date: '2026-01-06', description: 'Frais', amount: -12, reference: undefined },
    ]);
  });
  it('tolerates semicolons and blank lines', () => {
    const r = parseBankCsv('date;description;amount\n\n2026-02-01;Vir;50\n');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].amount).toBe(50);
  });
  it('reports invalid amount as an error and skips the row', () => {
    const r = parseBankCsv('date,description,amount\n2026-01-01,Bad,abc');
    expect(r.rows).toHaveLength(0);
    expect(r.errors.length).toBe(1);
  });
});

describe('maskAccountNumber', () => {
  it('shows last 4', () => { expect(maskAccountNumber('123456789')).toBe('•••• 6789'); });
  it('handles null/short', () => { expect(maskAccountNumber(null)).toBe('—'); expect(maskAccountNumber('12')).toBe('•••• 12'); });
});

describe('bankBalance', () => {
  it('sums signed amounts round2', () => { expect(bankBalance([100.5, -12, 50])).toBe(138.5); });
});

describe('BankTxnStatus', () => {
  it('values', () => { expect(BankTxnStatus.UNRECONCILED).toBe('UNRECONCILED'); expect(BankTxnStatus.RECONCILED).toBe('RECONCILED'); });
});
```

- [ ] **Step 2: RED** — `pnpm --filter @pulsar/shared test -- banking` → FAIL.
- [ ] **Step 3: Implement**
```ts
// packages/shared/src/billing/banking.ts
export enum BankTxnStatus { UNRECONCILED = 'UNRECONCILED', RECONCILED = 'RECONCILED' }

export interface CsvBankRow { date: string; description: string; amount: number; reference?: string }

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Parse a simple bank CSV. Header: date,description,amount[,reference]. Accepts ',' or ';'. Skips blank lines. */
export function parseBankCsv(text: string): { rows: CsvBankRow[]; errors: string[] } {
  const rows: CsvBankRow[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return { rows, errors };
  const delim = lines[0].includes(';') ? ';' : ',';
  // drop header if it looks like one
  const start = /date/i.test(lines[0]) && /amount|montant/i.test(lines[0]) ? 1 : 0;
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(delim).map((p) => p.trim());
    const [date, description, amountRaw, reference] = parts;
    const amount = Number(amountRaw);
    if (!date || !description || amountRaw === undefined || amountRaw === '' || !Number.isFinite(amount)) {
      errors.push(`Line ${i + 1}: invalid (date/description/amount required, amount numeric)`);
      continue;
    }
    rows.push({ date, description, amount: round2(amount), reference: reference || undefined });
  }
  return { rows, errors };
}

export function maskAccountNumber(n?: string | null): string {
  if (!n) return '—';
  return `•••• ${n.slice(-4)}`;
}

export function bankBalance(amounts: number[]): number {
  return round2(amounts.reduce((s, a) => s + a, 0));
}
```
- [ ] **Step 4: Re-export** `export * from './billing/banking';` in `index.ts`.
- [ ] **Step 5: GREEN + build** — test + `pnpm --filter @pulsar/shared build`.
- [ ] **Step 6: Commit** `feat(shared): bank CSV parse + balance/mask helpers + BankTxnStatus`

---

### Task 2: Database — BankAccount + BankTransaction + Payment.reconciledAt

**Files:** `schema.prisma` + migration.

- [ ] **Step 1:** Add `enum BankTxnStatus { UNRECONCILED  RECONCILED }` near billing enums.
- [ ] **Step 2:** Add `BankAccount` + `BankTransaction` models verbatim from the spec (Decimal(12,2) on amount, cascade txn→account, `@@unique([tenantId,name])`, `matchedPaymentId String? @unique`, indexes, `@@map`).
- [ ] **Step 3:** Add `reconciledAt DateTime?` to `model Payment` (after `cancelledAt`).
- [ ] **Step 4:** Add `bankAccounts BankAccount[]` to `model Tenant`.
- [ ] **Step 5:** `pnpm db:up` then `pnpm db:migrate -- --name finance_banking` (additive). Then `pnpm --filter @pulsar/database build`.
- [ ] **Step 6: Commit** `feat(db): BankAccount/BankTransaction + Payment.reconciledAt`

---

### Task 3: API — BankAccountsService + controller

**Files:** Create `apps/api/src/modules/billing/banking/bank-accounts.service.ts`, `bank-accounts.controller.ts`, `dto/bank-account.dto.ts`; modify `billing.module.ts`.

- [ ] **Step 1: DTO** — `CreateBankAccountDto { name @Length(1,80); @IsOptional accountNumber?; @IsOptional glAccountCode? (@Matches /^[0-9A-Z]{1,10}$/, default '1010' applied in service); @IsOptional currency?; @IsOptional @IsBoolean isDefault? }`; `UpdateBankAccountDto extends PartialType`.
- [ ] **Step 2: Service** — tenant-scoped CRUD (update/remove guard with `findFirst({id,tenantId})` first). On isDefault:true clear others (same-tenant) in a tx. `balance(tenantId, id)`: load account (404 if not owned), `bankTransaction.aggregate({ where:{ bankAccountId:id, tenantId }, _sum:{ amount }, _count:true })` → `{ balance: round2(Number(sum ?? 0)), txnCount }`. **Projection masks the full accountNumber** — return `maskAccountNumber(accountNumber)` as a derived field (don't return the raw number in list/get; keep raw only server-side). Actually return both `accountNumber` masked: map rows to replace `accountNumber` with `maskAccountNumber(...)` (rule 10 spirit — never expose full number).
- [ ] **Step 3: Controller** — `@Controller('billing/bank-accounts')`, `@RequireModule(MODULE_KEYS.BILLING)`; GET list/:id/:id-balance → `LEDGER_READ`; POST/PATCH/DELETE → `LEDGER_MANAGE`.
- [ ] **Step 4: Wire BillingModule** (controller + service in providers + exports).
- [ ] **Step 5: Verify** typecheck + build (0). **Commit** `feat(api): bank accounts master + balance`

---

### Task 4: API — BankTransactionsService (list/create/import/reconcile/match/unmatch) + controller

**Files:** Create `apps/api/src/modules/billing/banking/bank-transactions.service.ts`, `bank-transactions.controller.ts`, `dto/bank-transaction.dto.ts`; modify `billing.module.ts`.

**Interfaces consumed:** `parseBankCsv`, `BankTxnStatus` (shared); `ModesOfPaymentService.resolveAccountCode`; `ModuleSettingsService`; `OwnershipService`/Prisma; `AuditLogsService`.

- [ ] **Step 1: DTO** — `CreateBankTransactionDto { @IsString bankAccountId; @IsDateString date; @IsString @Length(1,200) description; @IsNumber amount; @IsOptional @IsString reference }`; `ImportBankCsvDto { @IsString bankAccountId; @IsString csv }`; `MatchDto { @IsString paymentId }`.
- [ ] **Step 2: Service**
```ts
// key methods (mirror existing billing service style; inject PrismaService, AuditLogsService, ModesOfPaymentService)
list(tenantId, bankAccountId?, status?) // findMany tenant+filters, orderBy date desc
create(tenantId, dto)                    // assert bankAccount owned; create txn (UNRECONCILED)
async import(tenantId, bankAccountId, csv) {
  // assert account owned; const { rows, errors } = parseBankCsv(csv);
  // createMany rows → BankTransaction (tenantId, bankAccountId, date:new Date(r.date), amount, description, reference);
  // return { imported: rows.length, errors };
}
async reconciliation(tenantId, bankAccountId) {
  // assert account owned; get its glAccountCode.
  // unreconciledTransactions = bankTransaction.findMany({ where:{ tenantId, bankAccountId, status:'UNRECONCILED' } });
  // candidatePayments = payment.findMany({ where:{ tenantId, status:'SUBMITTED', reconciledAt:null } , include:{ modeOfPayment:true } })
  //   then filter in JS to those whose modeOfPayment.accountCode === account.glAccountCode;
  // return { unreconciledTransactions, candidatePayments };
}
async match(tenantId, userId, txnId, paymentId) {
  // load txn (404, must be owned + UNRECONCILED); load payment (404, owned, SUBMITTED, reconciledAt null);
  // $transaction: claim updateMany BankTransaction {id,tenantId,status:UNRECONCILED} → {status:RECONCILED, matchedPaymentId}; if count===0 throw Conflict;
  //   updateMany Payment {id,tenantId,reconciledAt:null} → {reconciledAt:new Date()}; if count===0 throw Conflict (rollback);
  // audit; return txn.
}
async unmatch(tenantId, userId, txnId) {
  // load txn (owned, RECONCILED with matchedPaymentId); $transaction: set txn UNRECONCILED + matchedPaymentId null; set payment.reconciledAt null; audit.
}
```
- [ ] **Step 3: Controller** — `@Controller('billing/bank-transactions')`, BILLING module; `GET ?bankAccountId=&status=` + `GET reconciliation?bankAccountId=` → `LEDGER_READ`; `POST` (create) + `POST import` + `POST :id/match` + `POST :id/unmatch` → `LEDGER_MANAGE`. Declare `reconciliation` and `import` routes BEFORE `:id/...` to avoid shadowing.
- [ ] **Step 4: Wire BillingModule.** Verify typecheck + build (0). **Commit** `feat(api): bank transactions + CSV import + reconciliation/match`

---

### Task 5: API — banking e2e

**Files:** Create `apps/api/test/banking.e2e-spec.ts`. Mirror billing-ledger/payments e2e bootstrap.
- [ ] **Step 1:** Cover: create bank account (glAccountCode 1010); `POST import` 2 CSV lines → imported 2; `GET :id/balance` = signed sum; create+submit a Payment via the "Banque" mode (accountCode 1010, seeded); `GET reconciliation?bankAccountId=` lists that payment as candidate; `POST :txnId/match {paymentId}` → txn RECONCILED + payment.reconciledAt set (verify via GET); `POST :txnId/unmatch` reverts both; tenant isolation 404. Unique codes; assert concrete values.
- [ ] **Step 2:** `pnpm --filter @pulsar/api test:e2e -- banking` all pass. **Commit** `test(api): banking e2e (import/balance/reconcile/match/isolation)`

---

### Task 6: Web — banking page + nav

**Files:** Create `apps/web/src/routes/(app)/billing/banking/+page.svelte`; modify `navigation.ts`.
- [ ] **Step 1:** Tabbed page: **Comptes** (CRUD, masked number, balance per account), **Transactions** (filter by account/status, manual create form, CSV import textarea → POST import showing imported/errors), **Rapprochement** (pick account → two columns: unreconciled transactions | candidate payments; "Matcher" calls `:id/match {paymentId}`, "Dé-matcher" calls `:id/unmatch`; reload after). Mirror existing billing page idiom; **align types to the real API responses and grep for stale field names**; valid tones; Number-coerce.
- [ ] **Step 2:** Nav `{ href: '/billing/banking', label: 'Banque', perm: PERMISSIONS.BILLING.LEDGER_READ }` after "Rapports financiers".
- [ ] **Step 3:** `pnpm --filter @pulsar/web typecheck` 0 errors. **Commit** `feat(web): banking page (accounts/transactions/reconciliation) + nav`

---

### Task 7: Final verification + docs
- [ ] **Step 1:** `pnpm typecheck` (0), `pnpm test` (shared incl banking.spec).
- [ ] **Step 2:** `pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm --filter @pulsar/api test:e2e` — full suite. No regression expected (additive + no GL change). Confirm pre-existing flakes (wms-fulfillment) in isolation.
- [ ] **Step 3:** Docs: CLAUDE.md "Hard rules (continued)" entry **45** for Banque (bank accounts + transactions + reconciliation matching payments; NO GL write from banking; `Payment.reconciledAt` is clearing-only, never alters status/amountPaid; `LEDGER_READ|MANAGE` gated; account number masked). Note in `docs/etat-du-projet.md`.
- [ ] **Step 4:** Commit fixups + docs.

---
## Self-Review notes (author)
- Coverage: helpers (T1), models (T2), accounts (T3), transactions+reconcile (T4), e2e (T5), web (T6), verify+docs (T7).
- Key correctness surface: the match $transaction (two conditional claims, both must succeed or rollback) and the candidate-payment filter (mode account == bank glAccountCode). No GL writes → low ledger risk.
- Type consistency: shared helpers (T1) consumed in T4; `resolveAccountCode` (from Payments sub-project) consumed in T4 reconciliation.
