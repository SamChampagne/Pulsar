# CRM cross-module events + finance link — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Émettre des événements de jalon CRM (deal won, sales-order confirmed/invoiced) visibles par le Control Tower de flux + l'automatisation + l'IA, et brancher un lien finance : commande `INVOICED` → relevé client brouillon via une réaction whitelistée.

**Architecture:** `DomainEventsService.emit` (best-effort) dans les services CRM ; une réaction `draft_invoice_from_sales_order` ajoutée au `REACTION_CATALOG` (`@pulsar/shared`) et exécutée par `ReactionExecutorService` (ModuleRef + lazy require, anti-cycle, règle 38) qui appelle une nouvelle méthode `CustomerInvoicesService.createDraftFromSalesOrder` ; une règle built-in seedée déclenche la réaction sur `crm.sales_order.invoiced`.

**Tech Stack:** NestJS, Prisma/Postgres, Vitest (shared), Jest+supertest (e2e). Aucune dépendance nouvelle, aucune migration.

## Global Constraints

- **Règle 38 (réactions):** la réaction passe par `REACTION_CATALOG` + `ReactionExecutorService` ; résolution des services métier via `ModuleRef.get(..., { strict:false })` + lazy `require()` — JAMAIS d'import statique de `BillingModule`/`CrmModule` (cycle). Idempotente sur `(tenantId, eventId, ruleId)` (déjà géré par l'exécuteur). Anti-boucle single-hop (déjà géré par `processPending`). Best-effort (échec → `FAILED`, jamais bloquant).
- **Règle 27/37 (events):** `DomainEventsService.emit(tenantId, type, subject, payload)` best-effort, jamais bloquant ; émettre APRÈS le claim de statut réussi. `moduleOfEventType('crm.*')` est déjà `'CRM'` — ne pas réimplémenter.
- **Règle 16/36 (billing):** `createDraftFromSalesOrder` lit les lignes de la commande (snapshots), ne recalcule aucun coût figé ; `defaultCurrency` en repli si la commande n'a pas de devise. Idempotent (pas de double-billing).
- **Règle 8:** n° de relevé via `SequencesService`. **Règle 1:** tenant-scope partout. **Règle 6:** audit sur la création de relevé.
- **Templates de référence (lire avant d'écrire):** `apps/api/src/core/automation/reaction-executor.service.ts` méthode `draftCustomerInvoice` (handler + lazy ModuleRef pattern) ; la règle built-in `load.completed → draft_customer_invoice` dans `packages/database/prisma/seed.ts` (~ligne 437) ; `CustomerInvoicesService.createDrafts` (`apps/api/src/modules/billing/customer-invoices.service.ts`) pour le modèle `CustomerInvoice` + lignes + n°.

---

### Task 1: Réaction au catalogue + tests purs (`@pulsar/shared`)

**Files:**
- Modify: `packages/shared/src/automation/reactions.ts`
- Modify: `packages/shared/src/automation/reactions.spec.ts` (si présent ; sinon créer) + un test `moduleOfEventType` dans le spec flow existant.

**Interfaces:**
- Produces: une entrée `REACTION_CATALOG` `{ key: 'draft_invoice_from_sales_order', label, module: 'billing', requiredModules: ['billing'], description, argKeys: ['salesOrderId'] }`.

- [ ] **Step 1: Failing test** — append to the reactions spec (mirror an existing assertion shape):

```ts
import { REACTION_CATALOG } from './reactions';
import { moduleOfEventType } from '../analytics/flow';

it('has draft_invoice_from_sales_order (billing, salesOrderId)', () => {
  const r = REACTION_CATALOG.find((x) => x.key === 'draft_invoice_from_sales_order');
  expect(r).toBeDefined();
  expect(r!.module).toBe('billing');
  expect(r!.requiredModules).toEqual(['billing']);
  expect(r!.argKeys).toEqual(['salesOrderId']);
});

it('maps crm.sales_order.invoiced to the CRM flow module', () => {
  expect(moduleOfEventType('crm.sales_order.invoiced')).toBe('CRM');
  expect(moduleOfEventType('crm.deal.won')).toBe('CRM');
});
```

(If the existing reactions spec uses a different import path / structure, match it. The `moduleOfEventType` test can go in the flow spec file if that's cleaner.)

- [ ] **Step 2: Run → FAIL** (`pnpm --filter @pulsar/shared test -- reactions` — the first test fails; the moduleOfEventType test already passes since `crm`→CRM exists).

- [ ] **Step 3: Add the catalog entry** — in `reactions.ts` `REACTION_CATALOG` array, add:

```ts
  {
    key: 'draft_invoice_from_sales_order',
    label: 'Créer un relevé client brouillon depuis la commande',
    module: 'billing',
    requiredModules: ['billing'],
    description:
      "À la facturation d'une commande de vente (sales order INVOICED), crée un relevé client brouillon à partir des lignes de la commande (anti-double-billing).",
    argKeys: ['salesOrderId'],
  },
```

- [ ] **Step 4: Run → PASS + rebuild** (`pnpm --filter @pulsar/shared test -- reactions && pnpm --filter @pulsar/shared build`).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/automation/reactions.ts packages/shared/src/automation/reactions.spec.ts packages/shared/src/analytics/flow.spec.ts
git commit -m "feat(crm): draft_invoice_from_sales_order reaction in REACTION_CATALOG"
```

(Only `git add` the spec files you actually touched.)

---

### Task 2: Émission des événements CRM (deal.won + sales_order.confirmed/invoiced)

**Files:**
- Modify: `apps/api/src/modules/crm/deals.service.ts`
- Modify: `apps/api/src/modules/crm/sales-orders.service.ts`

**Interfaces:**
- Consumes: `DomainEventsService.emit(tenantId, type, subject, payload)` (from `core/operating`, exposed via `OperatingModule` already imported by `CrmModule`).

- [ ] **Step 1: Inject DomainEventsService into DealsService** — add `private readonly domainEvents: DomainEventsService` to the constructor (import from `../../core/operating/domain-events.service`, mirror `crm-exceptions.service.ts`). In `advance(tenantId, id, userId, toStage)`, AFTER the successful claim/transition (where the audit STATUS_CHANGE is logged), if `toStage === CrmDealStage.WON`, emit best-effort:

```ts
await this.domainEvents.emit(
  tenantId,
  'crm.deal.won',
  { type: 'deal', id },
  { dealId: id, companyId: deal.companyId },
);
```

(Use the deal's `companyId` — fetch it if not already loaded in `advance`. `emit` is best-effort and never throws; no try/catch needed but do not let it block the return value.)

- [ ] **Step 2: Inject DomainEventsService into SalesOrdersService** — same injection. In `transition(tenantId, userId, id, to)`, AFTER the successful claim, emit per target:

```ts
if (to === SalesOrderStatus.CONFIRMED) {
  await this.domainEvents.emit(tenantId, 'crm.sales_order.confirmed', { type: 'sales-order', id },
    { salesOrderId: id, companyId: order.companyId, customerId: order.customerId });
} else if (to === SalesOrderStatus.INVOICED) {
  await this.domainEvents.emit(tenantId, 'crm.sales_order.invoiced', { type: 'sales-order', id },
    { salesOrderId: id, companyId: order.companyId, customerId: order.customerId });
}
```

(`order` = the order loaded before the claim; ensure `companyId`/`customerId` are available — select them when loading the current status. NOTE: there is no `transition` to INVOICED via an HTTP verb today — `FULFILLED→INVOICED` has no endpoint. Emit on whatever path sets INVOICED. If the only way to reach INVOICED is the future billing flow, still wire the emit in `transition` so it fires whenever INVOICED is set. ALSO add a `POST /crm/sales-orders/:id/invoice` verb? NO — out of scope; just ensure `transition` emits when `to===INVOICED`. The e2e will drive INVOICED by calling `transition` via a confirm→fulfill→ then a direct service call or a new minimal path. To keep the e2e able to reach INVOICED over HTTP, ADD a `POST /crm/sales-orders/:id/invoice` controller verb calling `transition(..., INVOICED)` — small, gated crm.manage. Add it.)

- [ ] **Step 3: Add the `invoice` verb** — in `sales-orders.controller.ts`, add `POST /:id/invoice` (crm.manage) → `transition(tenantId, userId, id, SalesOrderStatus.INVOICED)` (mirror confirm/fulfill). This lets FULFILLED→INVOICED happen and emit the event. (Also expose it in the web detail page's allowed actions if trivial — optional; not required this task.)

- [ ] **Step 4: Typecheck + build** — `pnpm --filter @pulsar/api typecheck && pnpm --filter @pulsar/api build`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/crm/deals.service.ts apps/api/src/modules/crm/sales-orders.service.ts apps/api/src/modules/crm/sales-orders.controller.ts
git commit -m "feat(crm): emit crm.deal.won + crm.sales_order.confirmed/invoiced + invoice verb"
```

---

### Task 3: `CustomerInvoicesService.createDraftFromSalesOrder` (lien finance)

**Files:**
- Modify: `apps/api/src/modules/billing/customer-invoices.service.ts`

**Interfaces:**
- Produces: `createDraftFromSalesOrder(tenantId: string, userId: string, salesOrderId: string): Promise<{ created: boolean; invoiceId?: string }>`.

- [ ] **Step 1: Read `createDrafts` + the CustomerInvoice model** — Read `customer-invoices.service.ts` `createDrafts` fully to learn: the `CustomerInvoice` Prisma model + its line model (shape, fields), how the number is minted (`SequencesService`), how `defaultCurrency` is resolved (règle 36), and the draft status value. Read the `prisma.salesOrder`/`salesOrderLineItem` shape (Cycle 3).

- [ ] **Step 2: Implement** — add the method. Logic:
  - Load the sales order tenant-scoped with its line items: `prisma.salesOrder.findFirst({ where: { id: salesOrderId, tenantId }, include: { lineItems: true } })`. If missing → `{ created: false }` (log).
  - If `order.customerId` is null → `{ created: false }` (log "no customer on sales order — skipping"). (The finance draft needs a Billing `Customer`.)
  - **Idempotence:** if a `customerInvoice` already exists for this order (query by `relatedType: 'sales-order'` + `relatedId: salesOrderId`, OR whatever soft-link the model supports — if the CustomerInvoice model has no relatedType/relatedId columns, add a tenant-scoped check on a dedicated field OR store the link in a notes/meta field; if there is genuinely no place to record the link, dedupe by checking for an existing DRAFT invoice for this customer with a line referencing the order — pick the simplest that the model supports and document it). If found → `{ created: false }`.
  - Create a DRAFT `CustomerInvoice` for `order.customerId` with a number via `SequencesService.nextNumber(tenantId, '<the customer-invoice sequence key createDrafts uses>')`, currency = `order.currency` (or `defaultCurrency` fallback per règle 36), and one invoice line per sales-order line item (description = line.name, quantity, unitPrice, the line total computed the SAME way as the SO via `computeLineTotal` from `@pulsar/shared` — do NOT reinvent). Record the link to the sales order in whatever field the model supports (e.g. `relatedType/relatedId` or notes). Audit (règle 6).
  - Return `{ created: true, invoiceId }`.
  - **Adapt to the real `CustomerInvoice` model.** If its line shape differs (e.g. ties to loads/shipments rather than free lines), create the closest faithful representation from the SO lines, and note any modelling gap in the report. Do NOT recompute any frozen cost (règle 16).

- [ ] **Step 3: Typecheck + build** — `pnpm --filter @pulsar/api typecheck && pnpm --filter @pulsar/api build`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/billing/customer-invoices.service.ts
git commit -m "feat(billing): createDraftFromSalesOrder — draft invoice from CRM sales-order lines (idempotent)"
```

---

### Task 4: Handler de réaction + règle built-in seedée

**Files:**
- Modify: `apps/api/src/core/automation/reaction-executor.service.ts`
- Modify: `packages/database/prisma/seed.ts`

**Interfaces:**
- Consumes: `CustomerInvoicesService.createDraftFromSalesOrder` (Task 3, resolved via ModuleRef).

- [ ] **Step 1: Add the dispatch case + handler** — in `reaction-executor.service.ts`, mirror `draftCustomerInvoice`:
  - In `dispatch()`'s switch, add `case 'draft_invoice_from_sales_order': return this.draftInvoiceFromSalesOrder(tenantId, command.args);`.
  - Implement `private async draftInvoiceFromSalesOrder(tenantId: string, args: Record<string, unknown>)`:
    - `const salesOrderId = String(args.salesOrderId ?? ''); if (!salesOrderId) return;`
    - Lazy-resolve `CustomerInvoicesService` via `require('../../modules/billing/customer-invoices.service')` + `this.moduleRef.get(CustomerInvoicesService, { strict: false })` (mirror `draftCustomerInvoice` exactly).
    - `const userId = await this.serviceAccountUserId(tenantId);` (the existing helper — for the agent/service-account attribution).
    - `await customerInvoices.createDraftFromSalesOrder(tenantId, userId, salesOrderId);` (best-effort — the executor already wraps + records FAILED on throw; match how `draftCustomerInvoice` handles its try/skip logging).

- [ ] **Step 2: Seed the built-in rule** — in `seed.ts`, near the `load.completed → draft_customer_invoice` built-in rule (~line 437), add a rule:

```ts
{
  eventType: 'crm.sales_order.invoiced',
  // ... mirror the exact shape of the neighbouring built-in rule (tenantId, enabled, name, etc.)
  action: { kind: 'RUN_ACTION', action: 'draft_invoice_from_sales_order', args: { salesOrderId: '{salesOrderId}' } },
}
```

Match the EXACT object shape of the existing built-in rules in the seed (whatever fields they carry: name, enabled, tenantId, conditions, idempotent upsert key). Re-run `pnpm db:seed` to confirm.

- [ ] **Step 3: Typecheck + build** — `pnpm --filter @pulsar/api typecheck && pnpm --filter @pulsar/api build`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/core/automation/reaction-executor.service.ts packages/database/prisma/seed.ts
git commit -m "feat(crm): wire crm.sales_order.invoiced → draft_invoice_from_sales_order reaction + seed rule"
```

---

### Task 5: e2e + vérification

**Files:**
- Create: `apps/api/test/crm-cross-module.e2e-spec.ts`

- [ ] **Step 1: Write the e2e** — mirror `crm-sales-orders.e2e-spec.ts` setup (login 200, enable `crm` + `billing` modules via `tenantModule.upsert` on `moduleDefinition`, `app.listen(0)`, unique suffixes). To drive reactions, find how the existing reactions e2e triggers `processPending` (the domain-events worker) — read an existing reactions/automation e2e (e.g. search `test/` for `processPending` or `reaction`) and reuse that mechanism (call the worker tick via the injected service, or the existing pattern). Assert:
  1. Create company + a WON deal (advance LEAD→QUALIFIED→PROPOSAL→WON) → a `DomainEvent` `crm.deal.won` exists (query prisma.domainEvent, tenant acme).
  2. Convert the WON deal → sales order (or create one with a customerId), confirm → fulfill → `POST /crm/sales-orders/:id/invoice` → a `DomainEvent` `crm.sales_order.invoiced` exists.
  3. Run the domain-events worker `processPending` (or its tick) → a `CustomerInvoice` DRAFT linked to the sales order exists AND a `ReactionExecution` row exists. Run `processPending` AGAIN → still exactly ONE invoice (idempotence).
  4. A sales order WITHOUT customerId, invoiced + processed → no invoice created, no crash.
  5. Tenant isolation: the events/invoice are scoped to acme.

  (To get a `customerId` on the order: convert a WON deal whose company was converted to a Customer — reuse `POST /crm/deals/:id/convert` then `create-sales-order`; OR set customerId directly. Pick the path the conversion supports.)

- [ ] **Step 2: Run e2e + typecheck** — `pnpm --filter @pulsar/api typecheck && pnpm --filter @pulsar/api test:e2e -- crm-cross-module`.

- [ ] **Step 3: Full verification** — `pnpm typecheck && pnpm test && pnpm build`, then `pnpm test:e2e` (full; known cross-suite flakes phase13/phase16 — confirm any failing suite passes in isolation; `crm-cross-module` must pass).

- [ ] **Step 4: Docs note** — one French line in `docs/etat-du-projet.md` (CRM section): événements de jalon CRM (deal.won, sales_order.*) + lien finance auto (commande facturée → relevé brouillon).

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/crm-cross-module.e2e-spec.ts docs/etat-du-projet.md
git commit -m "test(crm): e2e cross-module events + finance draft reaction; docs note"
```

---

## Self-Review

**Spec coverage:** réaction au catalogue + test → T1 ; émission events (deal.won + SO confirmed/invoiced + invoice verb) → T2 ; méthode finance createDraftFromSalesOrder → T3 ; handler réaction + règle seedée → T4 ; e2e + verif + docs → T5. ✓

**Placeholder scan:** T3 is the riskiest — it depends on the real `CustomerInvoice` model shape, which the implementer is explicitly told to READ first and adapt to (with a documented fallback for the order-link/idempotence field). T2/T4 reference concrete templates (`draftCustomerInvoice` handler, the `load.completed` seed rule) with the exact emit calls + dispatch case spelled out. T1/T5 carry full test code / explicit assertions.

**Type consistency:** reaction key `draft_invoice_from_sales_order` consistent across T1 (catalog), T4 (dispatch case + seed rule action). Event types `crm.deal.won`/`crm.sales_order.confirmed`/`crm.sales_order.invoiced` consistent across T2 (emit) and T5 (assert). `createDraftFromSalesOrder(tenantId, userId, salesOrderId)` signature consistent T3 (def) ↔ T4 (call). `SalesOrderStatus.INVOICED` (Cycle 3) used by T2 emit + the new invoice verb.
