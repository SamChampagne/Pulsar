# WMS v2 — WMS↔TMS Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the WMS prepare (pick) outbound TMS shipments — a `PickOrder` can reference a `Shipment` whose origin is a WMS warehouse; completing the pick decrements stock (unchanged) and the shipment's "prepared" state is derived from its linked pick orders.

**Architecture:** One nullable FK (`PickOrder.shipmentId`) + a pure derivation helper in `@pulsar/shared/wms` + a new `FulfillmentService`/controller in the WMS module + a `/wms/fulfillment` web workbench. NO TMS controllers, NO dispatch UI, NO new `ShipmentStatus`, NO dispatch blocking — everything lives in the WMS lane (another agent owns agents/integrations/dispatch UI).

**Tech Stack:** NestJS + Prisma (`@pulsar/database`), `@pulsar/shared` (pure, vitest), SvelteKit 5 runes (ssr=false), jest e2e in `apps/api/test`.

**Templates to mirror:** the WMS module just shipped — `apps/api/src/modules/wms/**` (esp. `picking/picking.service.ts`, `picking.controller.ts`, `overview/wms-overview.service.ts`), `packages/shared/src/wms/wms.workflow.ts`, web `apps/web/src/routes/(app)/wms/**` (esp. `picking/+page.svelte`, `+page.svelte` dashboard, `+layout.svelte` Warehouse nav group).

**Infra notes (Windows):**
- Run API as detached `node dist/main.js`; after any API rebuild kill the port-3000 PID and restart. NEVER run `pnpm --filter @pulsar/api build` while `pnpm dev` (nest watch) runs.
- After a Prisma migration, kill the detached API (it holds the client DLL lock) before `pnpm db:generate`.
- After changing `packages/shared` or `packages/database`, rebuild them.
- List endpoints cap `pageSize` at 100. `api()` web client now tolerates empty 200/201 bodies.

---

## File Structure

**`packages/shared/src/wms/wms.workflow.ts`** (modify): add `ShipmentPickStatus` type + `deriveShipmentPickStatus(...)`. **`wms.workflow.spec.ts`** (modify): add tests.

**`packages/database/prisma/schema.prisma`** (modify): `PickOrder.shipmentId` + relation + index; `Shipment.pickOrders` back-relation.

**`apps/api/src/modules/wms/`** (modify/create):
- `picking/dto/pick.dto.ts` (modify): `shipmentId?` on `CreatePickOrderDto`; `shipmentId?` on `PickListQueryDto`.
- `picking/picking.service.ts` (modify): validate + persist `shipmentId`; include shipment projection.
- `picking/picking.service.spec.ts` (modify): add link-validation tests.
- `fulfillment/fulfillment.service.ts` (create), `fulfillment/fulfillment.service.spec.ts` (create), `fulfillment/fulfillment.controller.ts` (create).
- `wms.module.ts` (modify): register `FulfillmentService` + `FulfillmentController`.

**`apps/api/test/wms-fulfillment.e2e-spec.ts`** (create).

**`apps/web/src/routes/(app)/`** (create/modify): `wms/fulfillment/+page.svelte` (create); `wms/picking/+page.svelte` (modify: show shipment ref); `+layout.svelte` (modify: "Préparation" nav entry).

**Docs** (modify): `CLAUDE.md` (extend rule 33), `docs/etat-du-projet.md`.

---

## Task 1: Shared — derive shipment pick status

**Files:**
- Modify: `packages/shared/src/wms/wms.workflow.ts`
- Modify: `packages/shared/src/wms/wms.workflow.spec.ts`

- [ ] **Step 1: Add the failing test** (append to `wms.workflow.spec.ts`)

```ts
import { deriveShipmentPickStatus } from './wms.workflow';

describe('deriveShipmentPickStatus', () => {
  it('NOT_PICKED when there are no pick orders', () => {
    expect(deriveShipmentPickStatus([])).toBe('NOT_PICKED');
  });
  it('NOT_PICKED when all linked pick orders are cancelled', () => {
    expect(deriveShipmentPickStatus([PickOrderStatus.CANCELLED, PickOrderStatus.CANCELLED])).toBe('NOT_PICKED');
  });
  it('PICKING when an open/picked order exists and none completed', () => {
    expect(deriveShipmentPickStatus([PickOrderStatus.OPEN])).toBe('PICKING');
    expect(deriveShipmentPickStatus([PickOrderStatus.PICKED, PickOrderStatus.CANCELLED])).toBe('PICKING');
  });
  it('PICKED when at least one linked order is completed', () => {
    expect(deriveShipmentPickStatus([PickOrderStatus.COMPLETED])).toBe('PICKED');
    expect(deriveShipmentPickStatus([PickOrderStatus.OPEN, PickOrderStatus.COMPLETED])).toBe('PICKED');
  });
});
```
(`PickOrderStatus` is already imported at the top of the spec from Task-1-of-v1; if not, add it to the existing import.)

- [ ] **Step 2: Run → FAIL**

Run: `pnpm --filter @pulsar/shared test -- wms.workflow`
Expected: FAIL (`deriveShipmentPickStatus` not exported).

- [ ] **Step 3: Implement** (append to `wms.workflow.ts`)

```ts
export type ShipmentPickStatus = 'NOT_PICKED' | 'PICKING' | 'PICKED';

/**
 * Derives a shipment's warehouse-preparation state from its linked pick orders.
 * ≥1 COMPLETED -> PICKED; else ≥1 non-terminal (OPEN/PICKED) -> PICKING; else NOT_PICKED.
 */
export function deriveShipmentPickStatus(pickOrderStatuses: PickOrderStatus[]): ShipmentPickStatus {
  if (pickOrderStatuses.some((s) => s === PickOrderStatus.COMPLETED)) return 'PICKED';
  if (pickOrderStatuses.some((s) => s === PickOrderStatus.OPEN || s === PickOrderStatus.PICKED)) return 'PICKING';
  return 'NOT_PICKED';
}
```

- [ ] **Step 4: Run → PASS + rebuild shared**

Run: `pnpm --filter @pulsar/shared test -- wms.workflow` → PASS.
Run: `pnpm --filter @pulsar/shared build` → clean. (Export already covered by `export * from './wms/wms.workflow'`.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/wms/wms.workflow.ts packages/shared/src/wms/wms.workflow.spec.ts
git commit -m "feat(shared): deriveShipmentPickStatus (WMS↔TMS prep state)"
```

---

## Task 2: Prisma — PickOrder.shipmentId

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1: Add the FK to `PickOrder`**

In `model PickOrder` add the field + relation (place near `locationId`):
```prisma
  shipmentId  String?
```
and in the relations block:
```prisma
  shipment    Shipment?       @relation(fields: [shipmentId], references: [id], onDelete: SetNull)
```
and add the index alongside the existing ones:
```prisma
  @@index([tenantId, shipmentId])
```

- [ ] **Step 2: Add the back-relation on `Shipment`**

In `model Shipment` relations block add:
```prisma
  pickOrders          PickOrder[]
```

- [ ] **Step 3: Kill API, migrate, generate**

```bash
# free port 3000 (PowerShell): Stop-Process the listener PID
pnpm db:migrate    # name: wms_pick_order_shipment   (uses prisma migrate dev via the repo's dotenv wrapper)
pnpm db:generate
```
Expected: migration `*_wms_pick_order_shipment`; client regenerated (PickOrder has `shipmentId`, `shipment` relation).

- [ ] **Step 4: Rebuild database package**

```bash
pnpm --filter @pulsar/database build
```
(No seed change needed — no new permissions/modules.)

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): PickOrder.shipmentId (optional link to outbound shipment)"
```

---

## Task 3: PickingService — accept & validate shipmentId

**Files:**
- Modify: `apps/api/src/modules/wms/picking/dto/pick.dto.ts`
- Modify: `apps/api/src/modules/wms/picking/picking.service.ts`
- Modify: `apps/api/src/modules/wms/picking/picking.service.spec.ts`

**Read first:** the current `picking.service.ts` + `pick.dto.ts` (you are extending them, keep everything that works).

- [ ] **Step 1: DTOs**

In `pick.dto.ts`, add to `CreatePickOrderDto`:
```ts
  @IsOptional() @IsString() shipmentId?: string;
```
and to `PickListQueryDto`:
```ts
  @IsOptional() @IsString() shipmentId?: string;
```

- [ ] **Step 2: Add the failing test** (append to `picking.service.spec.ts`)

Extend the existing harness so `prisma` also has a `shipment.findFirst` and the pickOrder create captures `shipmentId`. Add a self-contained harness for create-link tests:
```ts
import { PickOrderStatus } from '@pulsar/shared';
import { PickingService } from './picking.service';

function createHarness(opts: { shipment?: any; location?: any } = {}) {
  const created: any[] = [];
  const prisma = {
    location: { findFirst: async () => opts.location ?? { id: 'loc1', tenantId: 't1', type: 'WAREHOUSE' } },
    shipment: { findFirst: async () => opts.shipment ?? null },
    pickOrder: { create: async ({ data }: any) => { const row = { id: 'p1', ...data }; created.push(row); return row; } },
  } as any;
  const inventory = {} as any;
  const sequences = { nextNumber: async () => 'PK-0001' } as any;
  const ownership = { assertOwnedIfSet: async () => undefined } as any;
  const audit = { log: async () => undefined } as any;
  return { svc: new PickingService(prisma, inventory, sequences, ownership, audit), created };
}

describe('PickingService.create with shipmentId', () => {
  it('persists the link when locationId matches the shipment origin warehouse', async () => {
    const h = createHarness({
      location: { id: 'loc1', tenantId: 't1', type: 'WAREHOUSE' },
      shipment: { id: 'sh1', tenantId: 't1', originLocationId: 'loc1' },
    });
    await h.svc.create('t1', 'u1', { locationId: 'loc1', shipmentId: 'sh1' } as any);
    expect(h.created[0].shipmentId).toBe('sh1');
  });
  it('rejects when the pick location is not the shipment origin', async () => {
    const h = createHarness({
      location: { id: 'loc1', tenantId: 't1', type: 'WAREHOUSE' },
      shipment: { id: 'sh1', tenantId: 't1', originLocationId: 'OTHER' },
    });
    await expect(h.svc.create('t1', 'u1', { locationId: 'loc1', shipmentId: 'sh1' } as any)).rejects.toThrow();
  });
  it('rejects when the shipment does not exist for the tenant', async () => {
    const h = createHarness({ shipment: null });
    await expect(h.svc.create('t1', 'u1', { locationId: 'loc1', shipmentId: 'missing' } as any)).rejects.toThrow();
  });
});
```
NOTE: align the fake `location.findFirst`/`shipment.findFirst` with however the EXISTING `create` already validates the warehouse location (the v1 create already does a `location.findFirst` WAREHOUSE check — reuse/extend that call rather than adding a second roundtrip if possible).

- [ ] **Step 3: Run → FAIL**

Run: `pnpm --filter @pulsar/api test -- picking.service`
Expected: the new tests fail (link not handled).

- [ ] **Step 4: Implement in `picking.service.ts`**

In `create(tenantId, userId, dto)`, after the existing WAREHOUSE-location validation and before/within the `pickOrder.create`:
```ts
if (dto.shipmentId) {
  const shipment = await this.prisma.shipment.findFirst({
    where: { id: dto.shipmentId, tenantId },
    select: { id: true, originLocationId: true },
  });
  if (!shipment) throw new NotFoundException('Shipment not found');
  if (shipment.originLocationId !== dto.locationId) {
    throw new BadRequestException('Pick order location must match the shipment origin warehouse');
  }
}
```
(The location is already validated as WAREHOUSE by the existing v1 code; the equality check above ties it to the shipment origin.) Pass `shipmentId: dto.shipmentId ?? null` in the `pickOrder.create({ data: { ... } })`.

In `list(tenantId, query)`: add `...(query.shipmentId ? { shipmentId: query.shipmentId } : {})` to the `where`, and add `shipment: { select: { id: true, shipmentNumber: true, status: true } }` to the `include`.
In `get(tenantId, id)`: add the same `shipment` projection to the `include`.

Ensure `NotFoundException`/`BadRequestException` are imported from `@nestjs/common` (likely already).

- [ ] **Step 5: Run → PASS**

Run: `pnpm --filter @pulsar/api test -- picking.service` → all PASS (old + 3 new).

- [ ] **Step 6: Build + commit**

```bash
pnpm --filter @pulsar/api build   # clean
git add apps/api/src/modules/wms/picking
git commit -m "feat(api): pick orders can link to an outbound shipment (origin-warehouse validated)"
```

---

## Task 4: FulfillmentService + controller

**Files:**
- Create: `apps/api/src/modules/wms/fulfillment/fulfillment.service.ts`
- Create: `apps/api/src/modules/wms/fulfillment/fulfillment.service.spec.ts`
- Create: `apps/api/src/modules/wms/fulfillment/fulfillment.controller.ts`

**Read first:** `apps/api/src/modules/wms/overview/wms-overview.service.ts` (service shape + Prisma usage) and `wms-overview.controller.ts` (controller decorators).

- [ ] **Step 1: Write the failing test**

`fulfillment.service.spec.ts`:
```ts
import { FulfillmentService } from './fulfillment.service';

function harness(shipments: any[]) {
  const prisma = {
    shipment: {
      findMany: async () => shipments,
      findFirst: async ({ where }: any) => shipments.find((s) => s.id === where.id && s.tenantId === where.tenantId) ?? null,
    },
  } as any;
  return new FulfillmentService(prisma);
}

describe('FulfillmentService.pendingShipments', () => {
  it('attaches a derived pickStatus to each shipment', async () => {
    const svc = harness([
      { id: 'a', tenantId: 't1', shipmentNumber: 'SH-1', status: 'PLANNED', originLocation: { code: 'WH' }, destinationLocation: { code: 'C1' }, pickOrders: [] },
      { id: 'b', tenantId: 't1', shipmentNumber: 'SH-2', status: 'PLANNED', originLocation: { code: 'WH' }, destinationLocation: { code: 'C2' }, pickOrders: [{ id: 'p1', number: 'PK-1', status: 'COMPLETED' }] },
    ]);
    const res = await svc.pendingShipments('t1');
    expect(res.find((s: any) => s.id === 'a').pickStatus).toBe('NOT_PICKED');
    expect(res.find((s: any) => s.id === 'b').pickStatus).toBe('PICKED');
  });
});

describe('FulfillmentService.shipmentFulfillment', () => {
  it('returns the shipment with its pick orders and derived status', async () => {
    const svc = harness([
      { id: 'a', tenantId: 't1', shipmentNumber: 'SH-1', status: 'PLANNED', originLocation: { code: 'WH' }, destinationLocation: { code: 'C1' }, pickOrders: [{ id: 'p1', number: 'PK-1', status: 'PICKED' }] },
    ]);
    const res = await svc.shipmentFulfillment('t1', 'a');
    expect(res.pickStatus).toBe('PICKING');
    expect(res.pickOrders).toHaveLength(1);
  });
  it('throws when the shipment is not found for the tenant', async () => {
    const svc = harness([]);
    await expect(svc.shipmentFulfillment('t1', 'missing')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @pulsar/api test -- fulfillment.service`

- [ ] **Step 3: Implement `fulfillment.service.ts`**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { ShipmentStatus, deriveShipmentPickStatus } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class FulfillmentService {
  constructor(private readonly prisma: PrismaService) {}

  async pendingShipments(tenantId: string) {
    const shipments = await this.prisma.shipment.findMany({
      where: {
        tenantId,
        status: { in: [ShipmentStatus.PENDING, ShipmentStatus.PLANNED] },
        originLocation: { type: 'WAREHOUSE' },
      },
      orderBy: { plannedPickupEarly: 'asc' },
      take: 100,
      include: {
        originLocation: { select: { id: true, code: true, name: true } },
        destinationLocation: { select: { id: true, code: true, name: true } },
        pickOrders: { select: { id: true, number: true, status: true } },
      },
    });
    return shipments.map((s) => ({ ...s, pickStatus: deriveShipmentPickStatus(s.pickOrders.map((p) => p.status as any)) }));
  }

  async shipmentFulfillment(tenantId: string, shipmentId: string) {
    const shipment = await this.prisma.shipment.findFirst({
      where: { id: shipmentId, tenantId },
      include: {
        originLocation: { select: { id: true, code: true, name: true } },
        destinationLocation: { select: { id: true, code: true, name: true } },
        pickOrders: { include: { lines: { include: { item: { select: { sku: true, name: true } }, fromBin: { select: { code: true } } } } } },
      },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    return { ...shipment, pickStatus: deriveShipmentPickStatus(shipment.pickOrders.map((p) => p.status as any)) };
  }
}
```
(Confirm `ShipmentStatus` is exported from `@pulsar/shared`; it is — `enums/transportation.ts`. The `as any` casts bridge the Prisma-generated enum vs the shared enum, the same pattern picking/receiving services use.)

- [ ] **Step 4: Run → PASS.** `pnpm --filter @pulsar/api test -- fulfillment.service`

- [ ] **Step 5: Controller `fulfillment.controller.ts`**

```ts
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { FulfillmentService } from './fulfillment.service';

@ApiTags('wms/fulfillment')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.WMS)
@Controller('wms/fulfillment')
export class FulfillmentController {
  constructor(private readonly svc: FulfillmentService) {}

  @Get('pending')
  @RequirePermissions(PERMISSIONS.WMS.READ)
  pending(@CurrentUser() user: AuthUser) {
    return this.svc.pendingShipments(user.tenantId);
  }

  @Get('shipments/:id')
  @RequirePermissions(PERMISSIONS.WMS.READ)
  shipment(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.shipmentFulfillment(user.tenantId, id);
  }
}
```
(Mirror the exact decorator import paths used by `wms-overview.controller.ts` — adjust if they differ.)

- [ ] **Step 6: Build + commit**

```bash
pnpm --filter @pulsar/api build   # clean (not yet wired; tsc compiles)
git add apps/api/src/modules/wms/fulfillment
git commit -m "feat(api): WMS FulfillmentService — outbound shipments to pick + derived pick status"
```

---

## Task 5: Wire fulfillment into WmsModule

**Files:**
- Modify: `apps/api/src/modules/wms/wms.module.ts`

- [ ] **Step 1: Register**

Import `FulfillmentService` + `FulfillmentController`; add `FulfillmentController` to `controllers` and `FulfillmentService` to `providers`. (No new imports needed — PrismaService is global.)

- [ ] **Step 2: Build (DI check) + boot smoke if port free**

Run: `pnpm --filter @pulsar/api build` → clean. If port 3000 is free, boot `node apps/api/dist/main.js` ~6s and confirm `Mapped {/api/v1/wms/fulfillment/pending, GET}` + `.../shipments/:id`, then stop. Else rely on build + mirrored pattern.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/wms/wms.module.ts
git commit -m "feat(api): wire WMS FulfillmentController/Service"
```

---

## Task 6: E2e — fulfill an outbound shipment

**Files:**
- Create: `apps/api/test/wms-fulfillment.e2e-spec.ts`

**Read first:** `apps/api/test/wms-module.e2e-spec.ts` (bootstrap, login, enable WMS+TRANSPORTATION, WAREHOUSE location + bins + item creation, the receive→post flow to seed stock) and how a `Shipment` is created in e2e (grep `test/*.e2e-spec.ts` for `shipmentNumber` / `transportOrders` / `shipments` — a shipment needs a `transportOrderId` + origin/destination locations; mirror whichever existing suite creates orders/shipments. If creating a full TransportOrder→Shipment chain via API is heavy, create the shipment directly via Prisma in `beforeAll` like other suites seed fixtures — check how wms-module/dispatch suites create their domain rows).

- [ ] **Step 1: Write the suite**

`beforeAll`: bootstrap, login admin (acme), enable WMS + TRANSPORTATION; create a WAREHOUSE Location (unique code), a RECEIVING + STORAGE bin, an item; receive 20 into STORAGE (receipt → line → post) so stock exists; create an **outbound Shipment** whose `originLocationId` = the warehouse (+ a destination location + a parent TransportOrder, however the existing suites do it; unique numbers).

Tests:
1. **Pending lists the shipment as NOT_PICKED**: `GET /wms/fulfillment/pending` → contains our shipment with `pickStatus === 'NOT_PICKED'`.
2. **Create a linked pick order**: `POST /wms/pick-orders { locationId: warehouse, shipmentId }` → 201; add line `{ itemId, fromBinId: storage, qty: 5 }`; `GET /wms/fulfillment/shipments/:id` → `pickStatus === 'PICKING'`.
3. **Complete decrements + flips to PICKED**: `POST /wms/pick-orders/:id/complete` → `GET /wms/inventory?itemId=&binId=storage` shows 15 (20-5); `GET /wms/fulfillment/shipments/:id` → `pickStatus === 'PICKED'`; that shipment no longer appears as NOT_PICKED in `pending` (it appears as PICKED or is filtered — assert its pickStatus is PICKED in pending OR it's still listed but PICKED; match the implementation — `pending` lists PENDING/PLANNED shipments regardless of pickStatus, so assert it's present with pickStatus PICKED).
4. **Link validation**: `POST /wms/pick-orders { locationId: <a different warehouse or bin's location>, shipmentId }` where location ≠ origin → expect 400. (Create a 2nd WAREHOUSE location for this, or reuse a mismatched id.)
5. **Tenant isolation**: `GET /wms/fulfillment/shipments/:id` with acme token works; cross-tenant covered structurally (skip-with-comment if no 2nd-tenant token, per the wms-module suite).
6. **Module gating**: skip-with-comment (covered by `@RequireModule`).

Use `Number(...)` on Decimal strings; filter to created ids; `afterAll` cleanup of created docs (cascade lines).

- [ ] **Step 2: Run until GREEN**

Run: `pnpm --filter @pulsar/api test:e2e -- wms-fulfillment`
If a real bug surfaces (validation, derivation, projection), fix the underlying code and note it.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/wms-fulfillment.e2e-spec.ts
git add -A apps/api/src/modules/wms   # any fixes
git commit -m "test(api): WMS fulfillment e2e — link pick to shipment, complete -> PICKED + decrement"
```

---

## Task 7: Web — fulfillment workbench + picking shipment ref + nav

**Files:**
- Create: `apps/web/src/routes/(app)/wms/fulfillment/+page.svelte`
- Modify: `apps/web/src/routes/(app)/wms/picking/+page.svelte`
- Modify: `apps/web/src/routes/(app)/(app) +layout.svelte` → actually `apps/web/src/routes/(app)/+layout.svelte`

**Read first:** `apps/web/src/routes/(app)/wms/picking/+page.svelte` (create-pick-order modal + line management — you'll reuse the create call with a `shipmentId`), `apps/web/src/routes/(app)/wms/+page.svelte` (dashboard cards + tones), `+layout.svelte` (Warehouse nav group). Component imports from `$lib/components/ui`.

- [ ] **Step 1: Nav** — in `+layout.svelte`, add an entry to the Warehouse group: `Préparation → /wms/fulfillment` (between `Réception` and `Prélèvement`).

- [ ] **Step 2: `/wms/fulfillment/+page.svelte`** (the outbound queue)

`GET /wms/fulfillment/pending` → table of shipments to prepare: shipmentNumber, origin (originLocation.code/name), → destination, plannedPickupEarly (formatted), weightKg, and a **pickStatus badge** (NOT_PICKED neutral / PICKING warn / PICKED ok). For a shipment not yet PICKED, a **"Créer le pick order"** button → `POST /wms/pick-orders { locationId: shipment.originLocationId, shipmentId: shipment.id }` → on success toast + navigate to `/wms/picking?shipmentId=<id>` (or open the created order). For a PICKED/PICKING shipment, a link to its pick order(s). `$state`/`$effect`/`load()`/error+toast like the other WMS pages. Empty state: "Aucun shipment à préparer." **pageSize ≤ 100** where applicable.

- [ ] **Step 3: `/wms/picking/+page.svelte`** — when a pick order has a linked shipment (the list/get now include `shipment: {shipmentNumber, status}`), show the ref (e.g. a badge `↔ SH-…`) in the list row and the detail panel. If the page reads a `?shipmentId=` query param, pre-filter the list to that shipment (use `GET /wms/pick-orders?shipmentId=`). Keep all existing behavior.

- [ ] **Step 4: check + build**

Run: `pnpm --filter @pulsar/web typecheck` → 0 errors. `pnpm --filter @pulsar/web build` → clean.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/routes/(app)/wms/fulfillment" "apps/web/src/routes/(app)/wms/picking/+page.svelte" "apps/web/src/routes/(app)/+layout.svelte"
git commit -m "feat(web): WMS fulfillment workbench (outbound queue) + shipment ref on picking"
```

(Browser verification is Task 8 by the controller — do not self-verify.)

---

## Task 8: Browser verification + rule 33 extension + docs + full build

**Files:**
- Modify: `CLAUDE.md` (extend rule 33)
- Modify: `docs/etat-du-projet.md`

- [ ] **Step 1: Restart API + ensure web up**

Kill port-3000 PID, `pnpm --filter @pulsar/api build`, start detached `node dist/main.js`, wait for 401 on `/api/v1/modules`. Ensure web on :5173.

- [ ] **Step 2: Browser-verify (chrome-devtools)** — login admin@pulsar.dev / admin123 / acme.
The acme tenant already has WAREHOUSE `WH-MTL` + bins + item `WIDGET-100` (from WMS v1 demo). Ensure some stock in a STORAGE bin (receive if needed). Create an **outbound shipment** originating from `WH-MTL` — if there's no easy UI path, create it via the API with the token (a TransportOrder + Shipment with `originLocationId` = WH-MTL). Then: open `/wms/fulfillment` → confirm the shipment is listed `NOT_PICKED` → "Créer le pick order" → add a line from the STORAGE bin → complete → confirm `/wms/inventory` decremented AND `/wms/fulfillment` (or the shipment detail) shows `PICKED`. Screenshot. **Fix any real bug found.**

- [ ] **Step 3: Extend rule 33 in CLAUDE.md**

Append to the existing rule 33 block (module WMS) a sentence (verbatim from the spec §E):
```
    (v2) Un `PickOrder` peut référencer un `Shipment` (`shipmentId?`) ; son `locationId` DOIT alors égaler
    `shipment.originLocationId` (Location `WAREHOUSE`), validé dans `PickingService.create`. Le décrément
    reste à la complétion (inchangé). L'état « préparé » d'un shipment est DÉRIVÉ de ses pick orders liés
    (`deriveShipmentPickStatus`, pur `@pulsar/shared`) — jamais un nouveau `ShipmentStatus`, jamais de
    blocage du dispatch (règle 2 préservée) ; toute la surface vit dans le module WMS (aucun contrôleur TMS modifié).
```

- [ ] **Step 4: Update `docs/etat-du-projet.md`** — add a short row/note under the Light WMS entry: "WMS v2 — tressage TMS : pick orders liés aux shipments sortants, statut de préparation dérivé, workbench `/wms/fulfillment` ; 27ᵉ migration". Bump "26 migrations" → "27 migrations".

- [ ] **Step 5: Full build + typecheck + tests**

```bash
pnpm build        # all green
pnpm typecheck    # 0 errors
pnpm --filter @pulsar/shared test   # includes deriveShipmentPickStatus
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/etat-du-projet.md
git commit -m "docs(wms): rule 33 v2 clause (pick↔shipment link) + status; WMS v2 shipped"
```

---

## Self-Review (completed by plan author)

**Spec coverage:** §A entity → Task 2. §B derive helper → Task 1. §C backend: picking link → Task 3, FulfillmentService/controller → Task 4, wiring → Task 5. §D web → Task 7. §E rule → Task 8. Tests → Tasks 1,3,4,6 + browser Task 8. All covered.

**Type consistency:** `deriveShipmentPickStatus(PickOrderStatus[]) → ShipmentPickStatus` defined Task 1, consumed identically in Task 4 service + Task 1/4/6 tests. `PickOrder.shipmentId` (Task 2) used in Task 3 create/list/get and Task 4 includes. `ShipmentStatus`/`PickOrderStatus` come from `@pulsar/shared`. Endpoints `/wms/fulfillment/pending` + `/shipments/:id` consistent across controller (Task 4), e2e (Task 6), web (Task 7).

**Flagged verification points (not placeholders):** exact `nextNumber` signature already known from v1; how e2e creates a Shipment (TransportOrder chain vs Prisma fixture) — Task 6 names the file to read; whether the existing picking `create` already does the WAREHOUSE `location.findFirst` (Task 3 says reuse it). The `as any` enum bridge matches the established pattern in picking/receiving services.

**No-collision check:** no TMS controller, no `/dispatch` page, no `ShipmentStatus` change, no dispatch-blocking — all additive in the WMS module + one nullable FK. Safe alongside the parallel agent's dispatch/agents/integrations work.
