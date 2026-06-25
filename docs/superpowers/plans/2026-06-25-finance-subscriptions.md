# Finance — Abonnements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Recurring subscriptions that generate DRAFT customer invoices per period (idempotent), reusing CustomerInvoice free lines. No direct GL write.

**Architecture:** `Subscription` + `SubscriptionLine` + `SubscriptionInvoice` (idempotence link) in the billing module; pure `advanceRunDate` + `canTransitionSubscription` in `@pulsar/shared`; generation creates a CustomerInvoice + free CustomerInvoiceLines + SubscriptionInvoice in one transaction and advances `nextRunDate`. New `billing.subscriptions.read|manage`. The generated invoice follows the existing billing approve→GL flow (no GL write here).

**Tech Stack:** NestJS, Prisma, SvelteKit Svelte-5, `@pulsar/shared`, Vitest, Jest+supertest.

## Global Constraints
- Tenant isolation (rule 1); `@RequireModule(MODULE_KEYS.BILLING)` + `billing.subscriptions.read|manage` (rule 5).
- Status changes via `canTransitionSubscription` + conditional `updateMany` claim (rule 2).
- Enum mirror shared↔Prisma (rule 3); rebuild after (rule 7).
- Audit transitions + generate (rule 6); FK customer validated (rule 9); invoice number via `SequencesService` key `customer-invoice` (rule 8).
- Generation idempotent on `(tenantId, subscriptionId, periodStart)`. NO direct GL write (generated invoice goes through the existing approve→GL flow). `run-due` is best-effort (one failure never aborts the rest, never throws globally).
- Money `Decimal(12,2)`, Number at boundary, round2. Web: align local types to REAL API DTO + grep; valid Tone union; verify `pnpm --filter @pulsar/web typecheck`.

---

### Task 1: Shared — subscription enums + advanceRunDate + state machine

**Files:** Create `packages/shared/src/billing/subscription.ts` + `subscription.spec.ts`; modify `index.ts`.

- [ ] **Step 1: Failing test**
```ts
// packages/shared/src/billing/subscription.spec.ts
import { describe, it, expect } from 'vitest';
import { advanceRunDate, canTransitionSubscription, SubscriptionStatus, SubscriptionInterval } from './subscription';
describe('advanceRunDate', () => {
  it('WEEKLY +7 days', () => {
    expect(advanceRunDate(new Date('2026-01-01T00:00:00Z'), SubscriptionInterval.WEEKLY).toISOString()).toBe('2026-01-08T00:00:00.000Z');
  });
  it('MONTHLY +1 month', () => {
    expect(advanceRunDate(new Date('2026-01-15T00:00:00Z'), SubscriptionInterval.MONTHLY).toISOString()).toBe('2026-02-15T00:00:00.000Z');
  });
  it('MONTHLY end-of-month rolls correctly (Jan 31 → Feb 28/29 not Mar)', () => {
    // UTC month add with clamp: Jan 31 + 1mo → Feb 28 (2026 not leap)
    expect(advanceRunDate(new Date('2026-01-31T00:00:00Z'), SubscriptionInterval.MONTHLY).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });
  it('YEARLY +1 year', () => {
    expect(advanceRunDate(new Date('2026-03-01T00:00:00Z'), SubscriptionInterval.YEARLY).toISOString()).toBe('2027-03-01T00:00:00.000Z');
  });
});
describe('canTransitionSubscription', () => {
  it('ACTIVE↔PAUSED, →CANCELLED; CANCELLED terminal', () => {
    expect(canTransitionSubscription(SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED)).toBe(true);
    expect(canTransitionSubscription(SubscriptionStatus.PAUSED, SubscriptionStatus.ACTIVE)).toBe(true);
    expect(canTransitionSubscription(SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED)).toBe(true);
    expect(canTransitionSubscription(SubscriptionStatus.CANCELLED, SubscriptionStatus.ACTIVE)).toBe(false);
  });
});
```
- [ ] **Step 2: RED** — `pnpm --filter @pulsar/shared test -- subscription`.
- [ ] **Step 3: Implement**
```ts
// packages/shared/src/billing/subscription.ts
export enum SubscriptionStatus { ACTIVE = 'ACTIVE', PAUSED = 'PAUSED', CANCELLED = 'CANCELLED' }
export enum SubscriptionInterval { WEEKLY = 'WEEKLY', MONTHLY = 'MONTHLY', YEARLY = 'YEARLY' }
export const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  [SubscriptionStatus.ACTIVE]: [SubscriptionStatus.PAUSED, SubscriptionStatus.CANCELLED],
  [SubscriptionStatus.PAUSED]: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED],
  [SubscriptionStatus.CANCELLED]: [],
};
export function canTransitionSubscription(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return SUBSCRIPTION_TRANSITIONS[from]?.includes(to) ?? false;
}
/** Advance a UTC date by one interval. MONTHLY/YEARLY clamp to end-of-month (Jan 31 +1mo → Feb 28). Pure: date is an argument. */
export function advanceRunDate(current: Date, interval: SubscriptionInterval): Date {
  const y = current.getUTCFullYear(), m = current.getUTCMonth(), d = current.getUTCDate();
  const hh = current.getUTCHours(), mm = current.getUTCMinutes(), ss = current.getUTCSeconds(), ms = current.getUTCMilliseconds();
  if (interval === SubscriptionInterval.WEEKLY) {
    return new Date(current.getTime() + 7 * 86400000);
  }
  const addMonths = interval === SubscriptionInterval.YEARLY ? 12 : 1;
  const targetMonthIndex = m + addMonths;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, daysInTargetMonth);
  return new Date(Date.UTC(targetYear, targetMonth, clampedDay, hh, mm, ss, ms));
}
```
- [ ] **Step 4: Re-export** `export * from './billing/subscription';` in `index.ts`.
- [ ] **Step 5: GREEN + build.** **Step 6: Commit** `feat(shared): subscription interval/status helpers + advanceRunDate`

---

### Task 2: Shared — billing.subscriptions permissions

**Files:** `permissions.ts`. Add `SUBSCRIPTIONS_READ: 'billing.subscriptions.read'`, `SUBSCRIPTIONS_MANAGE: 'billing.subscriptions.manage'` to the BILLING block AND the `billing(...)` catalog ('View subscriptions' / 'Manage subscriptions and recurring billing'). Build shared. Commit `feat(shared): billing.subscriptions.read|manage permissions`.

---

### Task 3: Database — Subscription + SubscriptionLine + SubscriptionInvoice

**Files:** `schema.prisma` + migration. Add enums `SubscriptionStatus {ACTIVE PAUSED CANCELLED}` + `SubscriptionInterval {WEEKLY MONTHLY YEARLY}` (mirror shared, multi-line). Add the 3 models verbatim from spec (Decimals, cascades, `SubscriptionInvoice @@unique([tenantId,subscriptionId,periodStart])`, indexes, `@@map`). Add `subscriptions Subscription[]` to `Tenant` AND to `Customer`. `pnpm db:up`; `pnpm db:migrate -- --name finance_subscriptions` (additive); `pnpm --filter @pulsar/database build`. Commit `feat(db): Subscription/SubscriptionLine/SubscriptionInvoice`. Touch only schema + migration.

---

### Task 4: API — SubscriptionsService (CRUD, transitions, generate, run-due) + controller

**Files:** Create `apps/api/src/modules/billing/subscriptions/subscriptions.service.ts`, `subscriptions.controller.ts`, `dto/subscription.dto.ts`; modify `billing.module.ts`.

- [ ] **Step 1: DTO** — `SubscriptionLineDto { @IsString @Length(1,200) description; @IsNumber @Min(0) amount }`; `CreateSubscriptionDto { @IsString @Length(1,80) name; @IsString customerId; @IsEnum(SubscriptionInterval) interval; @IsDateString startDate; @IsOptional @IsDateString nextRunDate?; @IsOptional @IsString @Length(3,3) currency?; @IsArray @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>SubscriptionLineDto) lines }`; `UpdateSubscriptionDto extends PartialType`.
- [ ] **Step 2: Service** (inject PrismaService, AuditLogsService, SequencesService, OwnershipService). Use `canTransitionSubscription`, `advanceRunDate`, `SubscriptionStatus`, `SubscriptionInterval` from `@pulsar/shared`.
  - CRUD tenant-scoped; assert `customerId` owned (OwnershipService.assertOwned 'customer'); `nextRunDate` defaults to `startDate` on create. update replaces lines in a tx; DELETE → if any `SubscriptionInvoice` exists for it → ConflictException, else cascade delete.
  - `pause`/`resume`/`cancel`: gate `canTransitionSubscription(current, target)`; claim `updateMany({where:{id,tenantId,status:current}, data:{status:target}})`; count===0 → 409/400; audit. (pause: ACTIVE→PAUSED; resume: PAUSED→ACTIVE; cancel: →CANCELLED.)
  - `generate(tenantId, userId, id)`: load subscription + lines (404); must be ACTIVE (else 400). `periodStart = startOfDayUtc(subscription.nextRunDate)`. `total = round2(sum(lines.amount))`. In `$transaction`:
    - `number = await this.sequences.nextNumber(tenantId, 'customer-invoice')` (call BEFORE or inside tx as the other services do — match the pattern; SequencesService uses its own prisma, safe to call before tx).
    - create `CustomerInvoice { tenantId, invoiceNumber:number, customerId, status:'DRAFT', currency, totalAmount: new Prisma.Decimal(total), lines: { create: subscription.lines.map(l => ({ description: l.description, amount: new Prisma.Decimal(Number(l.amount)), source: 'subscription', transportOrderId: null, priceDetail: Prisma.JsonNull })) } }` — match the CustomerInvoiceLine free-line shape used by `createDraftFromSalesOrder` in `customer-invoices.service.ts` (READ that method first to copy the exact free-line field set).
    - create `SubscriptionInvoice { tenantId, subscriptionId:id, periodStart, customerInvoiceId: invoice.id }` — wrap for P2002 (unique tenant,sub,periodStart) → ConflictException('Already generated for this period').
    - `updateMany Subscription {id,tenantId} data:{ nextRunDate: advanceRunDate(subscription.nextRunDate, subscription.interval) }`.
    - audit (entityType 'subscription'). Return the created invoice.
  - `runDue(tenantId, userId)`: `subs = findMany({where:{tenantId, status:'ACTIVE', nextRunDate:{ lte: new Date() }}})`; for each, `try { await this.generate(...) ; generated++ } catch { errors++/skipped++ }` (best-effort — never throw globally). Return `{ generated, skipped, errors }`.
- [ ] **Step 3: Controller** — `@Controller('billing/subscriptions')`, `@RequireModule(MODULE_KEYS.BILLING)`; `GET` list/:id → `SUBSCRIPTIONS_READ`; `POST`/`PATCH`/`DELETE`/`:id/pause`/`:id/resume`/`:id/cancel`/`:id/generate` + `POST run-due` → `SUBSCRIPTIONS_MANAGE`. Declare `run-due` before `:id` routes.
- [ ] **Step 4: Wire BillingModule.** Verify typecheck + build (0). **Commit** `feat(api): subscriptions CRUD + recurring invoice generation`

---

### Task 5: API — subscriptions e2e

**Files:** Create `apps/api/test/subscriptions.e2e-spec.ts`. Mirror billing-ledger/customer-invoice e2e bootstrap; grant `billing.subscriptions.read|manage`.
- [ ] Cover: create subscription (customer, MONTHLY, startDate, one line amount 50) → ACTIVE, nextRunDate=startDate; `POST :id/generate` → a DRAFT CustomerInvoice total 50 created (verify via GET /billing/customer-invoices/:id), a SubscriptionInvoice link, nextRunDate advanced +1 month; `POST :id/generate` again for the SAME (un-advanced... actually after advance the period changed) — to test idempotence, capture the periodStart and re-run by NOT advancing: instead assert that calling generate twice without the date changing is blocked → since generate advances nextRunDate, the simplest idempotence test: manually reset nextRunDate via Prisma to the original and call generate → 409 'Already generated for this period'. pause → generate → 400; cancel → status CANCELLED; run-due generates due ACTIVE subs; tenant isolation 404. Concrete assertions; unique codes.
- [ ] `pnpm --filter @pulsar/api test:e2e -- subscriptions` all pass. **Commit** `test(api): subscriptions recurring generation e2e`

---

### Task 6: Web — subscriptions page + nav

**Files:** Create `apps/web/src/routes/(app)/billing/subscriptions/+page.svelte`; modify `navigation.ts`.
- [ ] List (name, customer, interval, status badge, nextRunDate, total/period); create/edit modal (name, customer select [GET /transportation/customers], interval, startDate, repeatable lines description+amount); actions by status (ACTIVE→pause+generate; PAUSED→resume; →cancel); a global "Générer les abonnements dus" button (run-due) showing `{generated, skipped, errors}`; link to generated invoices. Align local types to the REAL API shapes (subscription + the generated CustomerInvoice) + grep. Number-coerce. Valid tones (ACTIVE ok, PAUSED warn, CANCELLED neutral).
- [ ] Nav `{ href: '/billing/subscriptions', label: 'Abonnements', perm: PERMISSIONS.BILLING.SUBSCRIPTIONS_READ }` after "Immobilisations".
- [ ] `pnpm --filter @pulsar/web typecheck` 0 errors. **Commit** `feat(web): subscriptions page + run-due + nav`

---

### Task 7: Final verification + docs
- [ ] `pnpm typecheck` (0), `pnpm test` (shared incl subscription.spec).
- [ ] `pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm --filter @pulsar/api test:e2e` — full suite. Additive; generates DRAFT invoices only (no GL until approved) → NO regression expected. Confirm pre-existing flakes in isolation.
- [ ] Docs: CLAUDE.md "Hard rules (continued)" entry **48** for Subscriptions (recurring subscriptions generate DRAFT CustomerInvoices via free lines; idempotent on `(tenantId,subscriptionId,periodStart)`; advances nextRunDate via pure `advanceRunDate`; status via `canTransitionSubscription`; NO direct GL write — generated invoice follows the billing approve→GL flow; `run-due` best-effort; `billing.subscriptions.read|manage`; invoice number via SequencesService `customer-invoice`). Accurate claims. `docs/etat-du-projet.md` note.
- [ ] Commit fixups + docs.

---
## Self-Review notes (author)
- Coverage: helpers+SM (T1), perms (T2), models (T3), service+generate+run-due (T4), e2e (T5), web (T6), verify+docs (T7).
- Risk surface: `generate` transaction (CustomerInvoice + free lines + SubscriptionInvoice idempotence + nextRunDate advance, all-or-nothing) — must match the CustomerInvoiceLine free-line shape exactly (read `createDraftFromSalesOrder` first). `run-due` best-effort isolation.
- Type consistency: `advanceRunDate`/`canTransitionSubscription` (T1) consumed in T4; SequencesService key `customer-invoice` reused.
