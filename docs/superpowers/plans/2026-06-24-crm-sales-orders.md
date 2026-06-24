# CRM Commandes de vente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Des commandes de vente CRM (catalogue de lignes, cycle de statut, numéro SO-) issues d'un deal gagné.

**Architecture:** `SalesOrder` + `SalesOrderLineItem` (calque des `CrmDealLineItem` du Cycle 2 — montant recalculé in-transaction via `sumLineItems`). State machine pure `canTransitionSalesOrder`. Numéro via `SequencesService`. Conversion deal WON+lignes → commande DRAFT. Outil agent READ. Pages web liste + détail (éditeur de lignes DRAFT-only + actions de statut).

**Tech Stack:** NestJS, Prisma/Postgres, SvelteKit (Svelte 5 runes), Vitest (shared), Jest+supertest (e2e). Aucune nouvelle dépendance.

## Global Constraints

- **R1:** tout query filtre `tenantId` du JWT. **R2:** statut via `canTransitionSalesOrder` + claim `updateMany` TOCTOU ; jamais d'`update({ status })` nu. **R3:** enum `SalesOrderStatus` dans `@pulsar/shared` ET schema.prisma (valeurs identiques) ; rebuild shared+database. **R6:** audit sur create/status/line mutations. **R8:** numéro via `SequencesService.nextNumber(tenantId, 'sales-order')`. **R9:** FK (`companyId`/`customerId`/`dealId`/`productId`) vérifiées.
- **Decimal→Number** à la frontière de calcul ; le helper `sumLineItems` (`@pulsar/shared`, Cycle 2) travaille en `number`.
- **Édition des lignes interdite hors statut DRAFT** (409).
- **Imports Prisma via `@pulsar/database`.** Listes `Paginated<T>`. DTO class-validator ; update via `PartialType`. Web : idiomes CRM existants (réutiliser, ne pas inventer).
- **Templates de référence** (le code à écrire en est le calque quasi 1:1) : `apps/api/src/modules/crm/products.service.ts` (CRUD + delete pattern), `line-items.service.ts` (recompute in-tx), `packages/shared/src/crm/crm.workflow.ts` (state machine), `apps/web/.../crm/deals/[id]/+page.svelte` (éditeur de lignes), `apps/web/.../crm/products/+page.svelte` (liste). Les implémenteurs DOIVENT lire le template nommé et s'y conformer (décorateurs `common/decorators/`, `AuditLogsService.log` shape, `tx: any` pour `$transaction`).

---

### Task 1: Shared — `SalesOrderStatus` + `canTransitionSalesOrder` + `isSalesOrderOpen`

**Files:**
- Create: `packages/shared/src/crm/sales-order.workflow.ts`
- Create: `packages/shared/src/crm/sales-order.workflow.spec.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `enum SalesOrderStatus { DRAFT, CONFIRMED, FULFILLED, INVOICED, CANCELLED }` (string values = names); `canTransitionSalesOrder(from: SalesOrderStatus, to: SalesOrderStatus): boolean`; `isSalesOrderOpen(s: SalesOrderStatus): boolean`.

- [ ] **Step 1: Failing test**

```ts
// packages/shared/src/crm/sales-order.workflow.spec.ts
import { describe, it, expect } from 'vitest';
import { SalesOrderStatus, canTransitionSalesOrder, isSalesOrderOpen } from './sales-order.workflow';

describe('canTransitionSalesOrder', () => {
  it('DRAFT → CONFIRMED / CANCELLED', () => {
    expect(canTransitionSalesOrder(SalesOrderStatus.DRAFT, SalesOrderStatus.CONFIRMED)).toBe(true);
    expect(canTransitionSalesOrder(SalesOrderStatus.DRAFT, SalesOrderStatus.CANCELLED)).toBe(true);
    expect(canTransitionSalesOrder(SalesOrderStatus.DRAFT, SalesOrderStatus.FULFILLED)).toBe(false);
  });
  it('CONFIRMED → FULFILLED / CANCELLED', () => {
    expect(canTransitionSalesOrder(SalesOrderStatus.CONFIRMED, SalesOrderStatus.FULFILLED)).toBe(true);
    expect(canTransitionSalesOrder(SalesOrderStatus.CONFIRMED, SalesOrderStatus.CANCELLED)).toBe(true);
  });
  it('FULFILLED → INVOICED only', () => {
    expect(canTransitionSalesOrder(SalesOrderStatus.FULFILLED, SalesOrderStatus.INVOICED)).toBe(true);
    expect(canTransitionSalesOrder(SalesOrderStatus.FULFILLED, SalesOrderStatus.CANCELLED)).toBe(false);
  });
  it('terminal states never transition out', () => {
    for (const to of Object.values(SalesOrderStatus)) {
      expect(canTransitionSalesOrder(SalesOrderStatus.INVOICED, to)).toBe(false);
      expect(canTransitionSalesOrder(SalesOrderStatus.CANCELLED, to)).toBe(false);
    }
  });
});

describe('isSalesOrderOpen', () => {
  it('open for DRAFT/CONFIRMED/FULFILLED, closed for INVOICED/CANCELLED', () => {
    expect(isSalesOrderOpen(SalesOrderStatus.DRAFT)).toBe(true);
    expect(isSalesOrderOpen(SalesOrderStatus.FULFILLED)).toBe(true);
    expect(isSalesOrderOpen(SalesOrderStatus.INVOICED)).toBe(false);
    expect(isSalesOrderOpen(SalesOrderStatus.CANCELLED)).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`pnpm --filter @pulsar/shared test -- sales-order.workflow`) — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/crm/sales-order.workflow.ts
export enum SalesOrderStatus {
  DRAFT = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  FULFILLED = 'FULFILLED',
  INVOICED = 'INVOICED',
  CANCELLED = 'CANCELLED',
}

const TRANSITIONS: Record<SalesOrderStatus, SalesOrderStatus[]> = {
  [SalesOrderStatus.DRAFT]: [SalesOrderStatus.CONFIRMED, SalesOrderStatus.CANCELLED],
  [SalesOrderStatus.CONFIRMED]: [SalesOrderStatus.FULFILLED, SalesOrderStatus.CANCELLED],
  [SalesOrderStatus.FULFILLED]: [SalesOrderStatus.INVOICED],
  [SalesOrderStatus.INVOICED]: [],
  [SalesOrderStatus.CANCELLED]: [],
};

export function canTransitionSalesOrder(from: SalesOrderStatus, to: SalesOrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Open = not in a terminal state (INVOICED/CANCELLED). */
export function isSalesOrderOpen(s: SalesOrderStatus): boolean {
  return s !== SalesOrderStatus.INVOICED && s !== SalesOrderStatus.CANCELLED;
}
```

- [ ] **Step 4: Export** — in `packages/shared/src/index.ts`, after `export * from './crm/line-items';` add `export * from './crm/sales-order.workflow';`.

- [ ] **Step 5: Run → PASS + rebuild** (`pnpm --filter @pulsar/shared test -- sales-order.workflow && pnpm --filter @pulsar/shared build`).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/crm/sales-order.workflow.ts packages/shared/src/crm/sales-order.workflow.spec.ts packages/shared/src/index.ts
git commit -m "feat(crm): SalesOrderStatus + canTransitionSalesOrder state machine"
```

---

### Task 2: Prisma — `SalesOrder` + `SalesOrderLineItem` + enum + migration + SequenceKey

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Modify: `apps/api/src/prisma/sequences.service.ts`

**Interfaces:**
- Produces: `prisma.salesOrder`, `prisma.salesOrderLineItem`; Prisma enum `SalesOrderStatus`; SequenceKey `'sales-order'` (prefix `SO`).

- [ ] **Step 1: Prisma enum (mirror shared)** — add near the CRM models:

```prisma
enum SalesOrderStatus {
  DRAFT
  CONFIRMED
  FULFILLED
  INVOICED
  CANCELLED
}
```

- [ ] **Step 2: Models** — add the `SalesOrder` and `SalesOrderLineItem` models exactly as in the spec (`docs/superpowers/specs/2026-06-24-crm-sales-orders-design.md`, "Modèle de données"), including `@@unique([tenantId, number])`, indexes, `@@map`, and `onDelete: Cascade` on the line→order relation.

- [ ] **Step 3: Back-relations** — add `salesOrders SalesOrder[]` to `Tenant` and to `CrmCompany`; add `salesOrderLineItems SalesOrderLineItem[]` to `CrmProduct` (explicit back-relations, matching the schema's style).

- [ ] **Step 4: SequenceKey** — in `apps/api/src/prisma/sequences.service.ts`: add `| 'sales-order'` to the `SequenceKey` union and `'sales-order': 'SO',` to the `PREFIXES` record. Do NOT add a PREFIX_SETTING override (v1).

- [ ] **Step 5: Migrate + generate + build** — DB up: `pnpm db:migrate` (name `crm_sales_orders`), then `pnpm db:generate && pnpm --filter @pulsar/database build`. Verify additive (new tables/enum only).

- [ ] **Step 6: Typecheck** — `pnpm --filter @pulsar/database typecheck && pnpm --filter @pulsar/api typecheck`.

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations apps/api/src/prisma/sequences.service.ts
git commit -m "feat(crm): SalesOrder + SalesOrderLineItem models + migration + SO- sequence"
```

---

### Task 3: API commandes — `SalesOrdersService` + `SalesOrdersController` + DTO (CRUD + status actions)

**Files:**
- Create: `apps/api/src/modules/crm/sales-orders.service.ts`
- Create: `apps/api/src/modules/crm/sales-orders.controller.ts`
- Create: `apps/api/src/modules/crm/dto/sales-order.dto.ts`
- Modify: `apps/api/src/modules/crm/crm.module.ts`

**Interfaces:**
- Consumes: `SequencesService` (from the `@Global` PrismaModule), `AuditLogsService`, `canTransitionSalesOrder`/`SalesOrderStatus` (`@pulsar/shared`).
- Produces: `SalesOrdersService.list/get/create/update/transition` (used by Tasks 4/5/7).

- [ ] **Step 1: DTO** — `CreateSalesOrderDto { companyId (IsString, required); customerId?; dealId?; currency?; notes?; ownerUserId? }`; `UpdateSalesOrderDto extends PartialType(OmitType(CreateSalesOrderDto, ['companyId']))` with only `notes`/`ownerUserId`/`currency` writable (omit companyId/customerId/dealId from update); `SalesOrderListQueryDto extends ListQueryDto { status?: string; companyId?: string }` (search is on the base). Match the import path of `ListQueryDto` used by `product.dto.ts`.

- [ ] **Step 2: Service** — model on `products.service.ts` + `deals.service.ts`:
  - `list(tenantId, query)`: Paginated; filters status/companyId/search(number); `orderBy: createdAt desc`; include `company: { select: { id, name } }`.
  - `get(tenantId, id)`: `findFirst({ id, tenantId, include: { company, lineItems } })` → 404 if missing.
  - `create(tenantId, userId, dto)`: assert `companyId` owned (R9, inline findFirst); assert `customerId`/`dealId` owned if provided; `number = await sequences.nextNumber(tenantId, 'sales-order')`; create with `status: DRAFT, totalAmount: 0`; audit CREATE.
  - `update(tenantId, userId, id, dto)`: `updateMany({ id, tenantId })` of notes/ownerUserId/currency only; 404 if count 0; audit UPDATE.
  - `transition(tenantId, userId, id, to: SalesOrderStatus)`: load current status (findFirst); `if (!canTransitionSalesOrder(current, to)) throw BadRequestException`; claim `updateMany({ where: { id, tenantId, status: current }, data: { status: to } })`; if count 0 → conflict/refetch; audit STATUS_CHANGE (before/after). (Mirror `DealsService.advance`.)

- [ ] **Step 3: Controller** — `@Controller('crm/sales-orders')`, `@RequireModule(MODULE_KEYS.CRM)`. Routes: `GET /` (read), `GET /:id` (read), `POST /` (manage), `PATCH /:id` (manage), `POST /:id/confirm` → `transition(..., CONFIRMED)`, `POST /:id/fulfill` → `FULFILLED`, `POST /:id/cancel` → `CANCELLED` (all manage). Decorator imports from `common/decorators/` (match `products.controller.ts`).

- [ ] **Step 4: Register** in `crm.module.ts` (controller + provider + export `SalesOrdersService`).

- [ ] **Step 5: Typecheck + build** — `pnpm --filter @pulsar/api typecheck && pnpm --filter @pulsar/api build`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/crm/sales-orders.service.ts apps/api/src/modules/crm/sales-orders.controller.ts apps/api/src/modules/crm/dto/sales-order.dto.ts apps/api/src/modules/crm/crm.module.ts
git commit -m "feat(crm): sales-orders API (CRUD + status transitions via state machine)"
```

---

### Task 4: API lignes de commande (recompute totalAmount, DRAFT-only)

**Files:**
- Create: `apps/api/src/modules/crm/sales-order-line-items.service.ts`
- Create: `apps/api/src/modules/crm/sales-order-line-items.controller.ts`
- Create: `apps/api/src/modules/crm/dto/sales-order-line-item.dto.ts`
- Modify: `apps/api/src/modules/crm/crm.module.ts`

**Interfaces:**
- Produces: `SalesOrderLineItemsService.list/create/update/remove`; private `recomputeOrderTotal(tx, tenantId, salesOrderId)`.

This is the direct analogue of Cycle 2's `line-items.service.ts` (deal line items), with two differences: (a) it targets `SalesOrder`/`SalesOrderLineItem` and writes `salesOrder.totalAmount` instead of `deal.amount`; (b) **all mutations require the order to be in `DRAFT`** — else `ConflictException` (409).

- [ ] **Step 1: DTO** — `CreateSalesOrderLineItemDto { productId?; name?; quantity? (IsNumber Min 0); unitPrice? (Min 0); discountPct? (Min 0 Max 100) }`; `UpdateSalesOrderLineItemDto extends PartialType(...)`. (Calque de `dto/line-item.dto.ts`.)

- [ ] **Step 2: Service** — calque de `line-items.service.ts`:
  - `private async assertOrderDraft(tenantId, salesOrderId)`: findFirst order `{ id, tenantId }` → 404; if `status !== 'DRAFT'` → `ConflictException('Line items can only be edited on a DRAFT order')`; return order (for currency).
  - `recomputeOrderTotal(tx, tenantId, salesOrderId)`: read all lines, `sumLineItems(lines.map Number(...))`, `tx.salesOrder.updateMany({ where: { id, tenantId }, data: { totalAmount: total } })`.
  - `list`: assert order owned (DRAFT not required for list — read); return lines `orderBy createdAt asc`.
  - `create/update/remove`: `assertOrderDraft` first; productId snapshot (verify owned, R9); free line requires name; `$transaction` { write line; recompute }; audit. Delete recompute → 0 when empty.

- [ ] **Step 3: Controller** — `@Controller('crm/sales-orders/:soId/line-items')`, `@RequireModule(CRM)`, GET (read) / POST,PATCH,DELETE (manage). Mirror `line-items.controller.ts`.

- [ ] **Step 4: Register** in `crm.module.ts`.

- [ ] **Step 5: Typecheck + build.**

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/crm/sales-order-line-items.service.ts apps/api/src/modules/crm/sales-order-line-items.controller.ts apps/api/src/modules/crm/dto/sales-order-line-item.dto.ts apps/api/src/modules/crm/crm.module.ts
git commit -m "feat(crm): sales-order line-items API (recompute total, DRAFT-only edit)"
```

---

### Task 5: Conversion deal→commande + outil agent `crm_list_sales_orders` + e2e

**Files:**
- Modify: `apps/api/src/modules/crm/sales-orders.service.ts` (add `createFromDeal`)
- Modify: `apps/api/src/modules/crm/deals.controller.ts` (add `POST :id/create-sales-order`)
- Modify: `apps/api/src/core/agents/tools/crm.tools.ts`, `tool-types.ts`, `agents.module.ts`
- Create: `apps/api/test/crm-sales-orders.e2e-spec.ts`

**Interfaces:**
- Produces: `SalesOrdersService.createFromDeal(tenantId, userId, dealId)`; tool `crm_list_sales_orders` (READ); `crm.listSalesOrders`.

- [ ] **Step 1: `createFromDeal`** in `sales-orders.service.ts`:
  - load deal `findFirst({ id, tenantId, include: { company: true } })` → 404; require `stage === 'WON'` (BadRequestException else, mirror `convert`).
  - load deal line items (`crmDealLineItem` where `{ tenantId, dealId }`); require ≥1 (BadRequestException else).
  - `$transaction`: `number = nextNumber(tenantId, 'sales-order')`; create SalesOrder DRAFT `{ companyId: deal.companyId, customerId: deal.convertedCustomerId, dealId, currency: deal.currency, status: DRAFT }`; `createMany` the line items copied from deal lines (snapshot name/quantity/unitPrice/discountPct/currency, productId); recompute `totalAmount = sumLineItems(...)` and update. Audit CREATE (entityType `sales-order`, after `{ fromDeal: dealId }`).
  - return the created order.

- [ ] **Step 2: Deal controller endpoint** — in `deals.controller.ts`, inject `SalesOrdersService` (CrmModule already provides it) and add:

```ts
  @Post(':id/create-sales-order')
  @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  createSalesOrder(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.salesOrders.createFromDeal(user.tenantId, user.id, id);
  }
```

(Add `private readonly salesOrders: SalesOrdersService` to the controller constructor.)

- [ ] **Step 3: Agent tool** — `tool-types.ts`: add `listSalesOrders(tenantId, query): Promise<unknown>` to `crm`. `crm.tools.ts`: add `crm_list_sales_orders` (READ, `PERMISSIONS.CRM.READ`, `MODULE_KEYS.CRM`, input `{ status?: string }`, run → `ctx.services.crm.listSalesOrders(tenantId, args)`). `agents.module.ts`: inject `SalesOrdersService` into the factory (add to inject+params, position-aligned) and wire `listSalesOrders: (t, q) => salesOrders.list(t, q as never)`.

- [ ] **Step 4: e2e** — `crm-sales-orders.e2e-spec.ts`, mirroring `crm-products.e2e-spec.ts` setup (login 200, `findFirstOrThrow slug 'acme'`, `moduleDefinition key 'crm'`, `tenantModule.upsert`, `app.listen(0)`, unique suffixes, `Number()` for Decimals). Assert:
  1. `POST /crm/sales-orders` (companyId) → number starts `SO-`, status DRAFT.
  2. add 2 line items → `GET :id` totalAmount = sum.
  3. edit a line → recompute; `POST :id/confirm` → CONFIRMED.
  4. edit a line now → 409 (not DRAFT).
  5. `POST :id/fulfill` → FULFILLED; `POST :id/cancel` → 400 (FULFILLED can't cancel).
  6. conversion: create a WON deal + line items (via the deal line-items API), `POST /crm/deals/:id/create-sales-order` → order with copied lines, totalAmount correct, `dealId` set.
  7. tenant isolation: foreign tenant can't GET the order (build via service or assert 404 cross-tenant as in crm-get-deal).

- [ ] **Step 5: Run e2e + typecheck** — `pnpm --filter @pulsar/api typecheck && pnpm --filter @pulsar/api test:e2e -- crm-sales-orders`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/crm/sales-orders.service.ts apps/api/src/modules/crm/deals.controller.ts apps/api/src/core/agents/tools/crm.tools.ts apps/api/src/core/agents/tool-types.ts apps/api/src/core/agents/agents.module.ts apps/api/test/crm-sales-orders.e2e-spec.ts
git commit -m "feat(crm): deal→sales-order conversion + crm_list_sales_orders tool + e2e"
```

---

### Task 6: Web — liste `/crm/sales-orders` + nav

**Files:**
- Create: `apps/web/src/routes/(app)/crm/sales-orders/+page.svelte`
- Modify: `apps/web/src/lib/modules/navigation.ts`

- [ ] **Step 1: Read references** — `apps/web/src/routes/(app)/crm/products/+page.svelte` (list idiom) + how the "Produits"/"Catalogue" nav entry was added.

- [ ] **Step 2: Build the list** — paginated table: `number`, company name, status badge (DRAFT/CONFIRMED/FULFILLED/INVOICED/CANCELLED with tones), `totalAmount` formatted (coerce `Number()` — Decimal-as-string), createdAt. Filters: status select + search (number). Row click → `/crm/sales-orders/<id>`. French labels; loading/empty/error states.

- [ ] **Step 3: Nav** — add "Commandes" → `/crm/sales-orders` in the CRM "Catalogue" (or a "Commerce") section, gated `PERMISSIONS.CRM.READ`.

- [ ] **Step 4: Build** — `pnpm --filter @pulsar/web build` (green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/\(app\)/crm/sales-orders/+page.svelte apps/web/src/lib/modules/navigation.ts
git commit -m "feat(web): sales-orders list page + nav"
```

---

### Task 7: Web — détail `/crm/sales-orders/[id]` (éditeur lignes DRAFT-only + actions statut) + bouton sur deal

**Files:**
- Create: `apps/web/src/routes/(app)/crm/sales-orders/[id]/+page.svelte`
- Modify: `apps/web/src/routes/(app)/crm/deals/[id]/+page.svelte`

- [ ] **Step 1: Read reference** — `apps/web/src/routes/(app)/crm/deals/[id]/+page.svelte` (line-items editor pattern: catalog picker + free line, PATCH/DELETE, per-line total via `computeLineTotal` from `@pulsar/shared`, `reloadAll`).

- [ ] **Step 2: Build the detail page**:
  - Header: `number`, company link, status badge, `totalAmount` (Number coerce), owner, notes.
  - **Line-items editor**: same component pattern as the deal editor (`GET/POST/PATCH/DELETE /crm/sales-orders/:id/line-items`, catalog picker via `GET /crm/products?active=true&pageSize=100`, per-line total client-side via `computeLineTotal`). **Disable add/edit/delete when `status !== 'DRAFT'`** (show a hint "Commande verrouillée"). After each mutation, reload lines + the order header (totalAmount changed).
  - **Status actions**: buttons for the transitions allowed from the current status (Confirmer→confirm, Exécuter→fulfill, Annuler→cancel), each `POST /crm/sales-orders/:id/<verb>` then reload. Hide buttons not permitted from the current status.
  - French; loading/empty/error states.

- [ ] **Step 3: "Créer une commande" on the deal** — in `crm/deals/[id]/+page.svelte`, add a button visible when the deal `stage === 'WON'`: `POST /crm/deals/:id/create-sales-order` → on success navigate to `/crm/sales-orders/<created.id>`. Handle the "needs WON + line items" 400 with an inline error.

- [ ] **Step 4: Build** — `pnpm --filter @pulsar/web build` (green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/\(app\)/crm/sales-orders/\[id\]/+page.svelte apps/web/src/routes/\(app\)/crm/deals/\[id\]/+page.svelte
git commit -m "feat(web): sales-order detail (line editor DRAFT-only + status actions) + create-from-deal"
```

---

### Task 8: Vérification + docs

**Files:**
- Modify: `docs/etat-du-projet.md`

- [ ] **Step 1: Full verification** — `pnpm typecheck && pnpm test && pnpm build` (shared unit incl. `sales-order.workflow.spec.ts`).

- [ ] **Step 2: e2e** — `pnpm test:e2e` (incl. `crm-sales-orders`; the phase16 S6.2 full-suite failure is a KNOWN pre-existing cross-suite flake — passes 16/16 in isolation — not a regression; 1 phase13 skip acceptable).

- [ ] **Step 3: Docs note** — one French line under the CRM section of `docs/etat-du-projet.md`: commandes de vente (SalesOrder, cycle de statut, numéro SO-, conversion depuis un deal).

- [ ] **Step 4: Commit**

```bash
git add docs/etat-du-projet.md
git commit -m "docs(crm): note commandes de vente"
```

---

## Self-Review

**Spec coverage:** state machine → T1 ; modèles+migration+SO- → T2 ; API CRUD+statuts → T3 ; lignes recompute DRAFT-only → T4 ; conversion+tool+e2e → T5 ; web liste → T6 ; web détail+bouton deal → T7 ; vérif/docs → T8. ✓

**Placeholder scan:** API tasks (3/4) reference the named Cycle-2 templates (`products.service.ts`, `line-items.service.ts`) as the calque rather than re-pasting their full bodies — acceptable: the templates exist in-repo, the deltas (entity names, totalAmount, DRAFT-only guard, status transition) are spelled out explicitly. Web tasks reference the deal-detail/products pages. State machine + DTO + e2e tasks carry full code.

**Type consistency:** `SalesOrderStatus`/`canTransitionSalesOrder` (T1) used by T3 transition + T2 enum mirror. `sumLineItems` (Cycle 2) reused by T4/T5 recompute. `'sales-order'` SequenceKey (T2) used by T3 create + T5 createFromDeal. `SalesOrdersService.list` (T3) ↔ adapter `crm.listSalesOrders` (T5). `computeLineTotal` (Cycle 2 shared) reused by T7 web.
