# Billing — Ligne libre + Grand Livre v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** (A) factures client itémisables via une ligne libre (débloque les factures issues d'une commande CRM) ; (B) grand livre double-entrée v1 (plan comptable + écritures + balance) auto-posté depuis les jalons billing, configurable, exposé à l'IA.

**Architecture:** Migration additive sur `CustomerInvoiceLine` (FK transport nullable + champs ligne libre) ; nouveaux modèles `ChartOfAccount`/`JournalEntry`/`JournalLine` + enum `AccountType` (mirroré) ; helpers purs (`normalBalance`/`isBalanced`/`DEFAULT_CHART`) ; `LedgerService` (post idempotent + trialBalance + ensureChart) ; postage auto best-effort+idempotent depuis les transitions billing avec mappings de comptes configurables ; API ledger + 2 outils IA READ + page web.

**Tech Stack:** NestJS, Prisma/Postgres, SvelteKit (Svelte 5 runes), Vitest (shared), Jest+supertest (e2e).

## Global Constraints

- **R1** tenant-scope partout. **R2** postage APRÈS le claim de statut réussi. **R3** `AccountType` dans `@pulsar/shared` ET schema.prisma. **R6** audit sur écritures + chart. **R16/36** montants depuis lignes/snapshots, jamais de recompute figé ; `defaultCurrency` fallback. **R35/36** mappings de comptes + `ledgerAutoPost` dans `module-settings` billing.
- **Double-entrée garantie** au point d'écriture unique `LedgerService.post` via `isBalanced` ; **postage auto best-effort** (try/catch, n'altère jamais la transition billing) MAIS **idempotent** sur `(tenantId, sourceType, sourceId, sourceKind)` (pas de double-écriture).
- **Migration additive** : relaxer NOT NULL (transportOrderId, priceDetail) ne casse pas les lignes existantes ; nouveaux champs nullables.
- **Decimal→Number** à la frontière de calcul ; `computeLineTotal`/`sumLineItems` de `@pulsar/shared` réutilisés.
- **Templates de référence (lire avant d'écrire):** `customer-invoices.service.ts` (modèle CustomerInvoice/Line, createDraftFromSalesOrder de Cycle 6, send/deleteDraft) ; `products.service.ts` (CRUD + audit) ; `module-settings.ts` (descriptors billing) ; `billing.tools.ts` + `agents.module.ts` (outils) ; `billing/freight-audit/+page.svelte` (page web idiome) ; un controller billing pour les décorateurs.

---

### Task 1: Shared — `AccountType` + helpers ledger purs

**Files:** Create `packages/shared/src/billing/ledger.ts` + `ledger.spec.ts` ; Modify `packages/shared/src/index.ts`.

**Interfaces:** `enum AccountType { ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE }` (string values=names); `normalBalance(type): 'DEBIT'|'CREDIT'`; `isBalanced(lines: {debit:number;credit:number}[]): boolean`; `DEFAULT_CHART: { code:string; name:string; type:AccountType }[]`.

- [ ] **Step 1: Failing test**

```ts
// packages/shared/src/billing/ledger.spec.ts
import { describe, it, expect } from 'vitest';
import { AccountType, normalBalance, isBalanced, DEFAULT_CHART } from './ledger';

describe('normalBalance', () => {
  it('ASSET/EXPENSE → DEBIT, others → CREDIT', () => {
    expect(normalBalance(AccountType.ASSET)).toBe('DEBIT');
    expect(normalBalance(AccountType.EXPENSE)).toBe('DEBIT');
    expect(normalBalance(AccountType.LIABILITY)).toBe('CREDIT');
    expect(normalBalance(AccountType.EQUITY)).toBe('CREDIT');
    expect(normalBalance(AccountType.REVENUE)).toBe('CREDIT');
  });
});

describe('isBalanced', () => {
  it('true when Σdebit === Σcredit, ≥2 lines, each line one-sided', () => {
    expect(isBalanced([{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }])).toBe(true);
    expect(isBalanced([{ debit: 60, credit: 0 }, { debit: 40, credit: 0 }, { debit: 0, credit: 100 }])).toBe(true);
  });
  it('false when unbalanced / single line / two-sided line', () => {
    expect(isBalanced([{ debit: 100, credit: 0 }, { debit: 0, credit: 90 }])).toBe(false);
    expect(isBalanced([{ debit: 100, credit: 0 }])).toBe(false);
    expect(isBalanced([{ debit: 50, credit: 50 }, { debit: 0, credit: 100 }])).toBe(false);
    expect(isBalanced([])).toBe(false);
  });
  it('rounds to 2 decimals', () => {
    expect(isBalanced([{ debit: 33.33, credit: 0 }, { debit: 33.33, credit: 0 }, { debit: 33.34, credit: 0 }, { debit: 0, credit: 100 }])).toBe(true);
  });
});

describe('DEFAULT_CHART', () => {
  it('has the core accounts with valid types', () => {
    const codes = DEFAULT_CHART.map((a) => a.code);
    expect(codes).toEqual(expect.arrayContaining(['1000', '1100', '2000', '4000', '5000']));
    for (const a of DEFAULT_CHART) expect(Object.values(AccountType)).toContain(a.type);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`pnpm --filter @pulsar/shared test -- billing/ledger`).

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/billing/ledger.ts
export enum AccountType {
  ASSET = 'ASSET', LIABILITY = 'LIABILITY', EQUITY = 'EQUITY', REVENUE = 'REVENUE', EXPENSE = 'EXPENSE',
}

export function normalBalance(type: AccountType): 'DEBIT' | 'CREDIT' {
  return type === AccountType.ASSET || type === AccountType.EXPENSE ? 'DEBIT' : 'CREDIT';
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Balanced double-entry: ≥2 lines, each line exactly one-sided, Σdebit === Σcredit (2-dec). */
export function isBalanced(lines: { debit: number; credit: number }[]): boolean {
  if (lines.length < 2) return false;
  for (const l of lines) {
    const d = l.debit || 0, c = l.credit || 0;
    if (d < 0 || c < 0) return false;
    if ((d > 0 && c > 0) || (d === 0 && c === 0)) return false; // exactly one side non-zero
  }
  const totalD = round2(lines.reduce((s, l) => s + (l.debit || 0), 0));
  const totalC = round2(lines.reduce((s, l) => s + (l.credit || 0), 0));
  return totalD === totalC;
}

export const DEFAULT_CHART: { code: string; name: string; type: AccountType }[] = [
  { code: '1000', name: 'Encaisse', type: AccountType.ASSET },
  { code: '1100', name: 'Comptes clients', type: AccountType.ASSET },
  { code: '2000', name: 'Comptes fournisseurs', type: AccountType.LIABILITY },
  { code: '2100', name: 'Taxes à payer', type: AccountType.LIABILITY },
  { code: '3000', name: 'Capital', type: AccountType.EQUITY },
  { code: '4000', name: 'Revenus de transport', type: AccountType.REVENUE },
  { code: '5000', name: 'Charges transporteurs', type: AccountType.EXPENSE },
];
```

- [ ] **Step 4: Export** — add `export * from './billing/ledger';` to `index.ts`.
- [ ] **Step 5: Run → PASS + rebuild** (`pnpm --filter @pulsar/shared test -- billing/ledger && pnpm --filter @pulsar/shared build`).
- [ ] **Step 6: Commit** — `git add` the 3 files ; `feat(billing): ledger helpers — AccountType/normalBalance/isBalanced/DEFAULT_CHART`.

---

### Task 2: Permissions `billing.ledger.read|manage` (`@pulsar/shared`)

**Files:** Modify `packages/shared/src/permissions.ts`.

- [ ] **Step 1:** Add to `PERMISSIONS.BILLING` the keys `LEDGER_READ: 'billing.ledger.read'`, `LEDGER_MANAGE: 'billing.ledger.manage'` (match how the other `billing.*` keys are declared) AND register them in the permission catalog list (the `billing(...)`/catalog declarations) with descriptions "View the general ledger" / "Manage ledger (manual journal entries, chart)". Confirm `ALL_PERMISSION_KEYS`/`PermissionKey` union pick them up.
- [ ] **Step 2:** `pnpm --filter @pulsar/shared build`. Grep the keys resolve.
- [ ] **Step 3: Commit** — `feat(billing): billing.ledger.read/manage permissions`.

---

### Task 3: Prisma — modèles ledger + migration ligne libre (Partie A + B schema)

**Files:** Modify `packages/database/prisma/schema.prisma`.

- [ ] **Step 1: Part A migration on `CustomerInvoiceLine`** — `transportOrderId String?` (was non-null `@unique` → keep `@unique` but nullable), `priceDetail Json?` (was non-null). Add nullable fields: `source String?`, `quantity Decimal?`, `unitPrice Decimal?`, `salesOrderLineId String?`. (The `@unique` on a nullable column allows multiple NULLs in Postgres.)
- [ ] **Step 2: Part B — enum + models** — add `enum AccountType { ASSET LIABILITY EQUITY REVENUE EXPENSE }` and:

```prisma
model ChartOfAccount {
  id        String      @id @default(cuid())
  tenantId  String
  code      String
  name      String
  type      AccountType
  active    Boolean     @default(true)
  createdAt DateTime    @default(now())
  tenant Tenant       @relation(fields: [tenantId], references: [id])
  lines  JournalLine[]
  @@unique([tenantId, code])
  @@index([tenantId, type])
  @@map("chart_of_accounts")
}

model JournalEntry {
  id          String   @id @default(cuid())
  tenantId    String
  date        DateTime
  memo        String?
  sourceType  String?
  sourceId    String?
  sourceKind  String?
  createdById String?
  createdAt   DateTime @default(now())
  tenant Tenant        @relation(fields: [tenantId], references: [id])
  lines  JournalLine[]
  @@index([tenantId, date])
  @@index([tenantId, sourceType, sourceId, sourceKind])
  @@map("journal_entries")
}

model JournalLine {
  id             String   @id @default(cuid())
  tenantId       String
  journalEntryId String
  accountId      String
  debit          Decimal  @default(0)
  credit         Decimal  @default(0)
  memo           String?
  entry   JournalEntry   @relation(fields: [journalEntryId], references: [id], onDelete: Cascade)
  account ChartOfAccount @relation(fields: [accountId], references: [id])
  @@index([tenantId, accountId])
  @@index([tenantId, journalEntryId])
  @@map("journal_lines")
}
```

Add back-relations `Tenant.chartOfAccounts`, `Tenant.journalEntries` (explicit arrays).

- [ ] **Step 3: Migrate + generate + build** — `pnpm db:migrate` (name `billing_general_ledger`), `pnpm db:generate && pnpm --filter @pulsar/database build`. Verify the migration relaxes the two NOT NULLs and adds the tables/enum (additive). Verify `pnpm --filter @pulsar/database typecheck && pnpm --filter @pulsar/api typecheck`.
- [ ] **Step 4: Commit** — `feat(billing): ledger models + free invoice-line migration`.

---

### Task 4: `LedgerService` (post idempotent + trialBalance + ensureChart) + module wiring

**Files:** Create `apps/api/src/modules/billing/ledger/ledger.service.ts` ; Modify the billing module to provide+export it.

**Interfaces:**
- `ensureChart(tenantId): Promise<void>` — seed `DEFAULT_CHART` if the tenant has no accounts (idempotent).
- `post(tenantId, input: { date?: Date; memo?: string; sourceType?: string; sourceId?: string; sourceKind?: string; lines: { accountCode: string; debit?: number; credit?: number; memo?: string }[] }, userId?): Promise<{ posted: boolean; journalEntryId?: string }>` — resolve accountCode→accountId (tenant; `ensureChart` first), validate `isBalanced` (throw BadRequest if not for manual; for auto-post the caller wraps best-effort), idempotent on `(tenantId, sourceType, sourceId, sourceKind)` (skip if an entry exists → `{ posted: false }`), persist entry+lines in a tx, audit.
- `trialBalance(tenantId, asOf?): Promise<{ rows: {code,name,type,debit,credit,balance}[]; totalDebit; totalCredit }>` — read-time aggregation (group JournalLine by account, optional `date <= asOf` on the entry).
- `listJournal(tenantId, query): Promise<Paginated<entry+lines>>`, `listAccounts(tenantId)`.

- [ ] **Step 1: Implement the service** — model audit/tenant patterns on `products.service.ts`. Use `isBalanced` (Decimal→Number) before persisting. For idempotence, `findFirst({ where: { tenantId, sourceType, sourceId, sourceKind } })`. `trialBalance`: fetch lines (join entry for date filter) tenant-scoped, sum per account, `balance = debit - credit` (display sign by normalBalance is fine to leave as debit-credit). Round 2 decimals.
- [ ] **Step 2: Wire** the service in the billing module (provider + export).
- [ ] **Step 3: Typecheck + build.**
- [ ] **Step 4: Commit** — `feat(billing): LedgerService — post (idempotent, balanced) + trialBalance + ensureChart`.

---

### Task 5: Réviser `createDraftFromSalesOrder` → vraies lignes libres + garde-fous downstream

**Files:** Modify `apps/api/src/modules/billing/customer-invoices.service.ts` (+ any send/PDF/deleteDraft helper).

- [ ] **Step 1: Read** the Cycle-6 `createDraftFromSalesOrder` + the `send()`/`statementInclude`/`deleteDraft` code that touches `line.transportOrder`.
- [ ] **Step 2: Create real lines** — in `createDraftFromSalesOrder`, instead of header-only + `customData.soLines`, create `CustomerInvoiceLine` rows: `{ tenantId-scoped via parent, transportOrderId: null, source: 'sales-order', salesOrderLineId: soLine.id, description: soLine.name, quantity: Number(soLine.quantity), unitPrice: Number(soLine.unitPrice), amount: computeLineTotal({...}), priceDetail: null }`. Keep `totalAmount = sumLineItems(...)` and the `customData.salesOrderId` idempotence marker. (Keep `customData.soLines` if cheap, or drop it now that real lines exist.)
- [ ] **Step 3: Guard downstream null `transportOrderId`** — anywhere code does `line.transportOrder.orderNumber` (e.g. `send()` row rendering, `deleteDraft` mapping), handle the free-line case: use `line.description` when `transportOrderId`/`transportOrder` is null. Audit these call sites and fix each (the prior review flagged `deleteDraft` mapping + `send()` row table).
- [ ] **Step 4: Typecheck + build.**
- [ ] **Step 5: Commit** — `fix(billing): SO-sourced invoices create real free lines + guard null transportOrder downstream`.

---

### Task 6: Postage auto depuis les transitions billing + réglages configurables

**Files:** Modify `customer-invoices.service.ts`, `invoices.service.ts` (buy-side), `packages/shared/src/config/module-settings.ts`.

- [ ] **Step 1: Settings** — add to billing module-settings descriptors: `ledgerAutoPost` (boolean, def true), `arAccountCode` ('1100'), `revenueAccountCode` ('4000'), `cashAccountCode` ('1000'), `apAccountCode` ('2000'), `expenseAccountCode` ('5000'). Rebuild shared.
- [ ] **Step 2: Inject `LedgerService`** into `CustomerInvoicesService` + `InvoicesService` (billing-internal, no cycle). Resolve settings via the existing settings resolver (how billing reads `defaultCurrency`/tolerances — mirror it).
- [ ] **Step 3: Post after claim (best-effort, idempotent)** — wrap each in try/catch so a ledger failure NEVER breaks the billing transition:
  - `CustomerInvoicesService.approve` success → if `ledgerAutoPost`: `ledger.post(tenantId, { sourceType:'customer-invoice', sourceId:id, sourceKind:'approved', memo, lines:[{accountCode: arAccountCode, debit: total},{accountCode: revenueAccountCode, credit: total}] }, userId)`.
  - `CustomerInvoicesService.markPaid` success → `sourceKind:'paid'`, DR cash / CR AR.
  - `InvoicesService.approve` (buy-side) success → `sourceKind:'approved'`, DR expense / CR AP (totalAmount).
  - `InvoicesService.markPaid` success → `sourceKind:'paid'`, DR AP / CR cash.
- [ ] **Step 4: Typecheck + build.**
- [ ] **Step 5: Commit** — `feat(billing): auto-post ledger entries from invoice approve/pay (configurable, best-effort, idempotent)`.

---

### Task 7: API ledger (`LedgerController`)

**Files:** Create `apps/api/src/modules/billing/ledger/ledger.controller.ts` + DTO ; Modify billing module.

- [ ] **Step 1:** `@Controller('billing/ledger')`, `@RequireModule(MODULE_KEYS.BILLING)`. Routes (decorators from the same place other billing controllers use):
  - `GET /accounts` (read) → `ensureChart` then `listAccounts`.
  - `GET /journal` (read) → `listJournal` (Paginated, optional date/account filters).
  - `GET /trial-balance` (read) → `trialBalance(asOf?)`.
  - `POST /entries` (manage) → manual balanced entry: body `{ date?, memo?, lines: [{accountCode, debit?, credit?, memo?}] }` → `ledger.post(..., { sourceType:'manual', sourceKind: cuid/uuid for uniqueness })` ; `isBalanced` false → 400.
- [ ] **Step 2: Typecheck + build.**
- [ ] **Step 3: Commit** — `feat(billing): ledger API (accounts/journal/trial-balance/manual entry)`.

---

### Task 8: Outils IA + preset Finance + e2e ledger

**Files:** Modify `apps/api/src/core/agents/tools/billing.tools.ts`, `tool-types.ts`, `agents.module.ts` ; `packages/shared/src/agents/role-presets.ts` (Finance preset perms) ; Create `apps/api/test/billing-ledger.e2e-spec.ts`.

- [ ] **Step 1: Tools** — `get_trial_balance` (READ, `billing.ledger.read`, module BILLING) + `list_journal_entries` (READ) → `LedgerService`. Add `ledger` methods to `tool-types.ts` `billing`-side services + wire the adapter in `agents.module.ts` (inject `LedgerService`, position-aligned). Add `billing.ledger.read` to the Finance Analyst preset's `suggestedPermissions`.
- [ ] **Step 2: e2e** — mirror `crm-products.e2e-spec.ts` setup (login 200, enable `billing` + `crm`, `app.listen(0)`, unique suffixes, `Number()`). Assert: `GET /billing/ledger/accounts` seeds the default chart ; create a customer + a CustomerInvoice draft (via the billable/createDrafts path OR createDraftFromSalesOrder) → approve → a balanced JournalEntry (DR AR/CR Revenue) exists ; markPaid → DR Cash/CR AR ; re-approve path doesn't double-post (idempotence) ; `GET /trial-balance` Σdebit===Σcredit ; `POST /entries` unbalanced → 400 ; an SO-sourced invoice has real free lines (transportOrderId null, source 'sales-order') ; tenant isolation. (To get a CustomerInvoice to approve: the simplest reliable path is `createDraftFromSalesOrder` via a converted WON deal with line items — reuse the Cycle 6 e2e helpers — OR `POST /billing/customer-invoices` billable path if a ratable order exists. Pick what's reachable.)
- [ ] **Step 3: Run e2e + typecheck** — `pnpm --filter @pulsar/api typecheck && pnpm --filter @pulsar/api test:e2e -- billing-ledger`.
- [ ] **Step 4: Commit** — `feat(billing): ledger agent tools + Finance preset perm + e2e`.

---

### Task 9: Web — page `/billing/ledger` + nav

**Files:** Create `apps/web/src/routes/(app)/billing/ledger/+page.svelte` ; Modify nav.

- [ ] **Step 1: Read** `apps/web/src/routes/(app)/billing/freight-audit/+page.svelte` for the billing page idiom + how billing nav entries are declared.
- [ ] **Step 2: Build** — tabs **Plan comptable** (GET /accounts: code/name/type/active), **Journal** (GET /journal: date, memo, source, lines DR/CR per account — paginated), **Balance** (GET /trial-balance: per-account debit/credit/balance + totals with Σdebit===Σcredit shown). French; loading/empty/error; valid `Tone` only. Add a "Grand livre" nav entry under Billing gated `billing.ledger.read`.
- [ ] **Step 3: Build + typecheck** — `pnpm --filter @pulsar/web build && pnpm typecheck` (both green — svelte-check, not just vite build).
- [ ] **Step 4: Commit** — `feat(web): billing general-ledger page (chart/journal/trial-balance) + nav`.

---

### Task 10: Vérification + docs + seed chart

**Files:** Modify `packages/database/prisma/seed.ts` (seed default chart for acme), `docs/etat-du-projet.md`, `CLAUDE.md` (hard rule for the ledger).

- [ ] **Step 1: Seed** — in seed.ts, call/replicate `ensureChart` for the acme tenant (seed `DEFAULT_CHART` rows idempotently) so the ledger page isn't empty. Re-run `pnpm db:seed`.
- [ ] **Step 2: Full verification** — `pnpm typecheck && pnpm test && pnpm build`, then `pnpm test:e2e` (full; billing-ledger must pass; known phase13/phase16 cross-suite flakes — confirm any failing suite passes in isolation).
- [ ] **Step 3: Hard rule** — append to `CLAUDE.md`: the ledger is double-entry — every `JournalEntry` is posted only via `LedgerService.post` which enforces `isBalanced` (`@pulsar/shared`); auto-posting from billing transitions is best-effort (never blocks the transition) but idempotent on `(tenantId, sourceType, sourceId, sourceKind)`; account mappings are configurable (`module-settings` billing); trial balance is computed read-time (no rollup). Account `normalBalance` is derived from `AccountType`, never persisted.
- [ ] **Step 4: Docs note** — line in `docs/etat-du-projet.md` (Billing section).
- [ ] **Step 5: Commit** — `docs(billing): note general ledger + hard rule + seed default chart`.

---

## Self-Review

**Spec coverage:** helpers+enum → T1 ; permissions → T2 ; migration A (free line) + B (ledger models) → T3 ; LedgerService → T4 ; createDraftFromSalesOrder real lines + downstream guards → T5 ; auto-post + configurable settings → T6 ; API → T7 ; IA tools + preset + e2e → T8 ; web → T9 ; seed+verif+docs+hard rule → T10. ✓

**Placeholder scan:** T1 carries full code; the migration (T3), LedgerService (T4), and the createDraftFromSalesOrder revision + downstream guards (T5) are the risk areas — T5 explicitly says READ the send/deleteDraft code and guard each null `transportOrder` site. API/web/tools reference named templates with concrete routes/bodies.

**Type consistency:** `AccountType`/`isBalanced`/`normalBalance`/`DEFAULT_CHART` (T1) ↔ Prisma enum (T3) ↔ LedgerService (T4). `LedgerService.post/trialBalance` signatures (T4) ↔ auto-post callers (T6) ↔ API (T7) ↔ tools (T8). Account-code settings keys (T6) ↔ post() accountCode resolution (T4). Free-line fields (T3) ↔ createDraftFromSalesOrder (T5) ↔ e2e assertion (T8).
