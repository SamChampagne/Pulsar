# CRM Produits — Catalogue + lignes de produit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un catalogue de produits CRM + des lignes de produit sur les deals, avec un montant de deal calculé, plus une page de détail de deal pour les éditer.

**Architecture:** Deux entités Prisma (`CrmProduct`, `CrmDealLineItem`). Toute mutation de ligne recalcule `deal.amount` (= Σ lignes) dans la même transaction via un helper pur partagé. API CRUD produits + endpoints lignes imbriqués sous un deal. Outil agent READ `crm_list_products`. Web : page catalogue + nouvelle page de détail de deal `/crm/deals/[id]` avec éditeur de lignes.

**Tech Stack:** NestJS, Prisma/Postgres, SvelteKit (Svelte 5 runes), Vitest (shared), Jest+supertest (e2e). Aucune nouvelle dépendance.

## Global Constraints

- **R1 tenant isolation:** tout query filtre `tenantId` du JWT.
- **R3 enums:** aucun nouvel enum dans ce cycle.
- **R6 audit:** create/update/delete produits + lignes appellent `AuditLogsService.log()`.
- **R9 FK:** `productId`/`dealId` reçus en write vérifiés tenant-scopés avant persistance (pattern inline `findFirst({ id, tenantId })` comme `activities.service.ts`).
- **R35 (généralisé):** `customData` produit validé via `CustomFieldsService.validateValues('crm', ...)` à l'intake si une définition existe (mirroir des autres entités CRM ; si l'intégration custom-fields est lourde, suivre exactement ce que fait `companies.service.ts`/`contacts.service.ts` pour `customData`).
- **Montant dérivé:** toute mutation de ligne recalcule `deal.amount` dans la MÊME transaction. Le recalcul écrit via `updateMany({ where: { id, tenantId } })`. Jamais de modification de `stage` ici.
- **Decimal:** Prisma renvoie les `Decimal` en string sur JSON ; convertir avec `Number(...)` à la frontière de calcul. Le helper pur travaille en `number`.
- **Imports Prisma via `@pulsar/database`.** Listes en `Paginated<T>` (`paginationArgs`/`paginated`). DTO class-validator ; update via `PartialType` de `@nestjs/swagger`.
- **Web:** idiomes CRM existants — `$state`+`$effect` load(), client `api<T>()`, erreur locale. Réutiliser, ne pas inventer.

---

### Task 1: Helpers purs lignes (`@pulsar/shared`)

**Files:**
- Create: `packages/shared/src/crm/line-items.ts`
- Create: `packages/shared/src/crm/line-items.spec.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `computeLineTotal(line: { quantity: number; unitPrice: number; discountPct: number }): number`; `sumLineItems(lines: Array<{ quantity: number; unitPrice: number; discountPct: number }>): number`. Both round to 2 decimals.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/crm/line-items.spec.ts
import { describe, it, expect } from 'vitest';
import { computeLineTotal, sumLineItems } from './line-items';

describe('computeLineTotal', () => {
  it('multiplies quantity × unitPrice', () => {
    expect(computeLineTotal({ quantity: 3, unitPrice: 10, discountPct: 0 })).toBe(30);
  });
  it('applies a percentage discount', () => {
    expect(computeLineTotal({ quantity: 2, unitPrice: 100, discountPct: 10 })).toBe(180);
  });
  it('rounds to 2 decimals', () => {
    expect(computeLineTotal({ quantity: 3, unitPrice: 9.99, discountPct: 0 })).toBe(29.97);
    expect(computeLineTotal({ quantity: 1, unitPrice: 10, discountPct: 33.333 })).toBe(6.67);
  });
});

describe('sumLineItems', () => {
  it('sums line totals, rounded', () => {
    expect(sumLineItems([
      { quantity: 2, unitPrice: 100, discountPct: 10 }, // 180
      { quantity: 3, unitPrice: 9.99, discountPct: 0 },  // 29.97
    ])).toBe(209.97);
  });
  it('empty list is 0', () => {
    expect(sumLineItems([])).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pulsar/shared test -- line-items`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/crm/line-items.ts

/** Round a number to 2 decimals (half-up on the cent). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface LineItemAmounts {
  quantity: number;
  unitPrice: number;
  discountPct: number;
}

/** Line total = quantity × unitPrice × (1 − discountPct/100), rounded to 2 decimals. */
export function computeLineTotal(line: LineItemAmounts): number {
  const gross = line.quantity * line.unitPrice;
  const net = gross * (1 - line.discountPct / 100);
  return round2(net);
}

/** Sum of line totals, rounded to 2 decimals. */
export function sumLineItems(lines: LineItemAmounts[]): number {
  return round2(lines.reduce((acc, l) => acc + computeLineTotal(l), 0));
}
```

- [ ] **Step 4: Export**

In `packages/shared/src/index.ts`, after `export * from './crm/deal-signals';` add:

```ts
export * from './crm/line-items';
```

- [ ] **Step 5: Run test + rebuild shared**

Run: `pnpm --filter @pulsar/shared test -- line-items && pnpm --filter @pulsar/shared build`
Expected: PASS, build OK.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/crm/line-items.ts packages/shared/src/crm/line-items.spec.ts packages/shared/src/index.ts
git commit -m "feat(crm): pure line-item total helpers"
```

---

### Task 2: Schéma Prisma — `CrmProduct` + `CrmDealLineItem` + migration + reseed

**Files:**
- Modify: `packages/database/prisma/schema.prisma` (models + relations)
- Modify: `packages/database/prisma/seed.ts` (demo products + line items)

**Interfaces:**
- Produces (Prisma client): `prisma.crmProduct`, `prisma.crmDealLineItem`.

- [ ] **Step 1: Add the two models (near `CrmDeal`, ~line 2645)**

```prisma
model CrmProduct {
  id          String   @id @default(cuid())
  tenantId    String
  name        String
  sku         String?
  description String?
  unitPrice   Decimal  @default(0)
  currency    String   @default("CAD")
  active      Boolean  @default(true)
  customData  Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tenant    Tenant            @relation(fields: [tenantId], references: [id])
  lineItems CrmDealLineItem[]

  @@index([tenantId, active])
  @@map("crm_products")
}

model CrmDealLineItem {
  id          String   @id @default(cuid())
  tenantId    String
  dealId      String
  productId   String?
  name        String
  quantity    Decimal  @default(1)
  unitPrice   Decimal  @default(0)
  discountPct Decimal  @default(0)
  currency    String   @default("CAD")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  deal    CrmDeal     @relation(fields: [dealId], references: [id], onDelete: Cascade)
  product CrmProduct? @relation(fields: [productId], references: [id])

  @@index([tenantId, dealId])
  @@map("crm_deal_line_items")
}
```

- [ ] **Step 2: Add relations on `CrmDeal` and `Tenant`**

In `model CrmDeal`, add alongside the existing relations:

```prisma
  lineItems CrmDealLineItem[]
```

In `model Tenant`, add alongside the other CRM back-relations (search for an existing `crm`-prefixed relation array; if none, add near the email/crm relations):

```prisma
  crmProducts CrmProduct[]
```

- [ ] **Step 3: Migrate**

Run (DB up): `pnpm db:migrate` — name: `crm_products_line_items`.
Expected: migration applied cleanly.

- [ ] **Step 4: Generate + build database package**

Run: `pnpm db:generate && pnpm --filter @pulsar/database build`
Expected: `prisma.crmProduct`/`prisma.crmDealLineItem` available.

- [ ] **Step 5: Add seed data**

In `seed.ts`, in the CRM demo section (just before the `console.log('CRM demo data ready ...')` line ~626), create 3 products and 1-2 line items on an existing demo deal, then set that deal's amount to the computed sum. Use `sumLineItems` from `@pulsar/shared` (seed already imports from it elsewhere; if not, import it). Example shape (adapt variable names to the actual deal variable in scope):

```ts
  const prodA = await prisma.crmProduct.create({ data: { tenantId: tenant.id, name: 'Transport palette', sku: 'TR-PAL', unitPrice: 120, currency: 'CAD' } });
  const prodB = await prisma.crmProduct.create({ data: { tenantId: tenant.id, name: 'Entreposage (mois)', sku: 'WH-MO', unitPrice: 350, currency: 'CAD' } });
  await prisma.crmProduct.create({ data: { tenantId: tenant.id, name: 'Manutention', sku: 'HND', unitPrice: 45, currency: 'CAD' } });
  // attach two line items to an existing demo deal (use the deal variable already created above)
  await prisma.crmDealLineItem.createMany({ data: [
    { tenantId: tenant.id, dealId: someDeal.id, productId: prodA.id, name: 'Transport palette', quantity: 10, unitPrice: 120, currency: 'CAD' },
    { tenantId: tenant.id, dealId: someDeal.id, productId: prodB.id, name: 'Entreposage (mois)', quantity: 2, unitPrice: 350, currency: 'CAD' },
  ]});
  await prisma.crmDeal.update({ where: { id: someDeal.id }, data: { amount: sumLineItems([
    { quantity: 10, unitPrice: 120, discountPct: 0 }, { quantity: 2, unitPrice: 350, discountPct: 0 },
  ]) } });
```

Update the `console.log` to mention products. If you cannot find a stable existing-deal variable in scope, create a dedicated demo deal for the line items rather than guessing. Re-run `pnpm db:seed` to verify it succeeds.

- [ ] **Step 6: Typecheck database/api**

Run: `pnpm --filter @pulsar/database typecheck && pnpm --filter @pulsar/api typecheck`
Expected: PASS (api typecheck will fail later only if services use the models before they exist — they don't yet).

- [ ] **Step 7: Commit**

```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations packages/database/prisma/seed.ts
git commit -m "feat(crm): CrmProduct + CrmDealLineItem models + migration + seed"
```

---

### Task 3: API catalogue — `ProductsService` + `ProductsController` + DTO

**Files:**
- Create: `apps/api/src/modules/crm/products.service.ts`
- Create: `apps/api/src/modules/crm/products.controller.ts`
- Create: `apps/api/src/modules/crm/dto/product.dto.ts`
- Modify: `apps/api/src/modules/crm/crm.module.ts`

**Interfaces:**
- Produces (for Task 5/7): `ProductsService.list(tenantId, query)`, `.get(tenantId, id)`, `.create(tenantId, userId, dto)`, `.update(tenantId, userId, id, dto)`, `.remove(tenantId, userId, id)`.

- [ ] **Step 1: DTO**

```ts
// apps/api/src/modules/crm/dto/product.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { ListQueryDto } from '../../../common/pagination'; // adjust import to the actual ListQueryDto location used by other CRM DTOs

export class CreateProductDto {
  @IsString() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sku?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) unitPrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsObject() customData?: Record<string, unknown>;
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class ProductListQueryDto extends ListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() active?: string; // 'true'|'false'
}
```

(Check the real `ListQueryDto` import path used by `contact.dto.ts`/`deal.dto.ts` and match it — those already extend it for pagination.)

- [ ] **Step 2: Service**

```ts
// apps/api/src/modules/crm/products.service.ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { paginationArgs, paginated } from '../../common/pagination';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { CreateProductDto, ProductListQueryDto, UpdateProductDto } from './dto/product.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  async list(tenantId: string, query: ProductListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where = {
      tenantId,
      ...(query.active === 'true' ? { active: true } : query.active === 'false' ? { active: false } : {}),
      ...(query.search
        ? { OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { sku: { contains: query.search, mode: 'insensitive' as const } },
          ] }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.crmProduct.findMany({ where, orderBy: { name: 'asc' }, skip, take }),
      this.prisma.crmProduct.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const product = await this.prisma.crmProduct.findFirst({ where: { id, tenantId } });
    if (!product) throw new NotFoundException('CRM product not found');
    return product;
  }

  async create(tenantId: string, userId: string, dto: CreateProductDto) {
    const product = await this.prisma.crmProduct.create({
      data: {
        tenantId,
        name: dto.name,
        sku: dto.sku ?? null,
        description: dto.description ?? null,
        unitPrice: dto.unitPrice ?? 0,
        currency: dto.currency ?? 'CAD',
        active: dto.active ?? true,
        customData: (dto.customData as object) ?? undefined,
      },
    });
    await this.audit.log({ tenantId, userId, action: AuditAction.CREATE, entityType: 'crm-product', entityId: product.id, after: { name: product.name, unitPrice: dto.unitPrice } });
    return product;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateProductDto) {
    const { count } = await this.prisma.crmProduct.updateMany({
      where: { id, tenantId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.unitPrice !== undefined ? { unitPrice: dto.unitPrice } : {}),
        ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.customData !== undefined ? { customData: dto.customData as object } : {}),
      },
    });
    if (count === 0) throw new NotFoundException('CRM product not found');
    await this.audit.log({ tenantId, userId, action: AuditAction.UPDATE, entityType: 'crm-product', entityId: id, after: { ...dto } });
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, userId: string, id: string) {
    const product = await this.prisma.crmProduct.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!product) throw new NotFoundException('CRM product not found');
    const refs = await this.prisma.crmDealLineItem.count({ where: { tenantId, productId: id } });
    if (refs > 0) throw new ConflictException('Product is referenced by deal line items');
    await this.prisma.crmProduct.delete({ where: { id } });
    await this.audit.log({ tenantId, userId, action: AuditAction.DELETE, entityType: 'crm-product', entityId: id });
    return { ok: true };
  }
}
```

- [ ] **Step 3: Controller**

```ts
// apps/api/src/modules/crm/products.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ProductsService } from './products.service';
import { CreateProductDto, ProductListQueryDto, UpdateProductDto } from './dto/product.dto';

@ApiTags('crm')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CRM)
@Controller('crm/products')
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Get() @RequirePermissions(PERMISSIONS.CRM.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ProductListQueryDto) { return this.service.list(user.tenantId, query); }

  @Get(':id') @RequirePermissions(PERMISSIONS.CRM.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.service.get(user.tenantId, id); }

  @Post() @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) { return this.service.create(user.tenantId, user.id, dto); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateProductDto) { return this.service.update(user.tenantId, user.id, id, dto); }

  @Delete(':id') @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.service.remove(user.tenantId, user.id, id); }
}
```

(Verify decorator import paths against `companies.controller.ts` and match exactly.)

- [ ] **Step 4: Register in crm.module.ts**

Add `ProductsController` to `controllers`, `ProductsService` to `providers` and `exports`.

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @pulsar/api typecheck && pnpm --filter @pulsar/api build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/crm/products.service.ts apps/api/src/modules/crm/products.controller.ts apps/api/src/modules/crm/dto/product.dto.ts apps/api/src/modules/crm/crm.module.ts
git commit -m "feat(crm): products catalog API (CRUD + delete-guard)"
```

---

### Task 4: API lignes — `LineItemsService` + `LineItemsController` + DTO (recompute deal amount)

**Files:**
- Create: `apps/api/src/modules/crm/line-items.service.ts`
- Create: `apps/api/src/modules/crm/line-items.controller.ts`
- Create: `apps/api/src/modules/crm/dto/line-item.dto.ts`
- Modify: `apps/api/src/modules/crm/crm.module.ts`

**Interfaces:**
- Consumes: `sumLineItems` (Task 1), `ProductsService`-less (queries prisma directly).
- Produces: `LineItemsService.list/create/update/remove`; `recomputeDealAmount(tx, tenantId, dealId)` private.

- [ ] **Step 1: DTO**

```ts
// apps/api/src/modules/crm/dto/line-item.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';

export class CreateLineItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() productId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) quantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) unitPrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) discountPct?: number;
}

export class UpdateLineItemDto extends PartialType(CreateLineItemDto) {}
```

- [ ] **Step 2: Service**

```ts
// apps/api/src/modules/crm/line-items.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, sumLineItems } from '@pulsar/shared';
import type { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../../core/audit-logs/audit-logs.service';
import { CreateLineItemDto, UpdateLineItemDto } from './dto/line-item.dto';

@Injectable()
export class LineItemsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  private async assertDealOwned(tenantId: string, dealId: string) {
    const deal = await this.prisma.crmDeal.findFirst({ where: { id: dealId, tenantId }, select: { id: true, currency: true } });
    if (!deal) throw new NotFoundException('CRM deal not found');
    return deal;
  }

  /** Recompute deal.amount = Σ line totals. Runs inside the caller's transaction. */
  private async recomputeDealAmount(tx: Prisma.TransactionClient, tenantId: string, dealId: string) {
    const lines = await tx.crmDealLineItem.findMany({ where: { tenantId, dealId } });
    const total = sumLineItems(lines.map((l) => ({
      quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), discountPct: Number(l.discountPct),
    })));
    await tx.crmDeal.updateMany({ where: { id: dealId, tenantId }, data: { amount: total } });
    return total;
  }

  async list(tenantId: string, dealId: string) {
    await this.assertDealOwned(tenantId, dealId);
    return this.prisma.crmDealLineItem.findMany({ where: { tenantId, dealId }, orderBy: { createdAt: 'asc' } });
  }

  async create(tenantId: string, userId: string, dealId: string, dto: CreateLineItemDto) {
    const deal = await this.assertDealOwned(tenantId, dealId);

    let name = dto.name;
    let unitPrice = dto.unitPrice;
    let currency = deal.currency;
    if (dto.productId) {
      const product = await this.prisma.crmProduct.findFirst({ where: { id: dto.productId, tenantId } });
      if (!product) throw new BadRequestException(`Unknown crm-product "${dto.productId}"`);
      name = name ?? product.name;
      unitPrice = unitPrice ?? Number(product.unitPrice);
    }
    if (!name) throw new BadRequestException('Line item requires a name (or a productId)');

    const created = await this.prisma.$transaction(async (tx) => {
      const line = await tx.crmDealLineItem.create({
        data: {
          tenantId, dealId, productId: dto.productId ?? null, name,
          quantity: dto.quantity ?? 1, unitPrice: unitPrice ?? 0, discountPct: dto.discountPct ?? 0, currency,
        },
      });
      await this.recomputeDealAmount(tx, tenantId, dealId);
      return line;
    });
    await this.audit.log({ tenantId, userId, action: AuditAction.CREATE, entityType: 'crm-line-item', entityId: created.id, after: { dealId, name, quantity: created.quantity } });
    return created;
  }

  async update(tenantId: string, userId: string, dealId: string, id: string, dto: UpdateLineItemDto) {
    await this.assertDealOwned(tenantId, dealId);
    const existing = await this.prisma.crmDealLineItem.findFirst({ where: { id, tenantId, dealId }, select: { id: true } });
    if (!existing) throw new NotFoundException('CRM line item not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.crmDealLineItem.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
          ...(dto.unitPrice !== undefined ? { unitPrice: dto.unitPrice } : {}),
          ...(dto.discountPct !== undefined ? { discountPct: dto.discountPct } : {}),
        },
      });
      await this.recomputeDealAmount(tx, tenantId, dealId);
      return tx.crmDealLineItem.findUnique({ where: { id } });
    });
    await this.audit.log({ tenantId, userId, action: AuditAction.UPDATE, entityType: 'crm-line-item', entityId: id, after: { ...dto } });
    return updated;
  }

  async remove(tenantId: string, userId: string, dealId: string, id: string) {
    await this.assertDealOwned(tenantId, dealId);
    const existing = await this.prisma.crmDealLineItem.findFirst({ where: { id, tenantId, dealId }, select: { id: true } });
    if (!existing) throw new NotFoundException('CRM line item not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.crmDealLineItem.delete({ where: { id } });
      await this.recomputeDealAmount(tx, tenantId, dealId);
    });
    await this.audit.log({ tenantId, userId, action: AuditAction.DELETE, entityType: 'crm-line-item', entityId: id, after: { dealId } });
    return { ok: true };
  }
}
```

(Verify `Prisma.TransactionClient` is exported from `@pulsar/database`; if the codebase types transactions differently, match the existing pattern used in `activities.service.ts` / other services that use `$transaction` with a helper.)

- [ ] **Step 3: Controller**

```ts
// apps/api/src/modules/crm/line-items.controller.ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { LineItemsService } from './line-items.service';
import { CreateLineItemDto, UpdateLineItemDto } from './dto/line-item.dto';

@ApiTags('crm')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CRM)
@Controller('crm/deals/:dealId/line-items')
export class LineItemsController {
  constructor(private readonly service: LineItemsService) {}

  @Get() @RequirePermissions(PERMISSIONS.CRM.READ)
  list(@CurrentUser() user: AuthUser, @Param('dealId') dealId: string) { return this.service.list(user.tenantId, dealId); }

  @Post() @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  create(@CurrentUser() user: AuthUser, @Param('dealId') dealId: string, @Body() dto: CreateLineItemDto) { return this.service.create(user.tenantId, user.id, dealId, dto); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('dealId') dealId: string, @Param('id') id: string, @Body() dto: UpdateLineItemDto) { return this.service.update(user.tenantId, user.id, dealId, id, dto); }

  @Delete(':id') @RequirePermissions(PERMISSIONS.CRM.MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('dealId') dealId: string, @Param('id') id: string) { return this.service.remove(user.tenantId, user.id, dealId, id); }
}
```

- [ ] **Step 4: Register in crm.module.ts**

Add `LineItemsController` to `controllers`, `LineItemsService` to `providers` and `exports`.

- [ ] **Step 5: Typecheck + build**

Run: `pnpm --filter @pulsar/api typecheck && pnpm --filter @pulsar/api build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/crm/line-items.service.ts apps/api/src/modules/crm/line-items.controller.ts apps/api/src/modules/crm/dto/line-item.dto.ts apps/api/src/modules/crm/crm.module.ts
git commit -m "feat(crm): deal line-items API with deal.amount recompute"
```

---

### Task 5: Outil agent `crm_list_products` (READ) + e2e produits/lignes

**Files:**
- Modify: `apps/api/src/core/agents/tools/crm.tools.ts`
- Modify: `apps/api/src/core/agents/tool-types.ts`
- Modify: `apps/api/src/core/agents/agents.module.ts`
- Create: `apps/api/test/crm-products.e2e-spec.ts`

**Interfaces:**
- Consumes: `ProductsService.list` (Task 3), the line-items API (Task 4).
- Produces: tool `crm_list_products` (READ); `ToolServices.crm.listProducts`.

- [ ] **Step 1: tool-types entry**

In the `crm: { ... }` block of `tool-types.ts`, add:

```ts
    listProducts(tenantId: string, query: object): Promise<unknown>;
```

- [ ] **Step 2: tool**

Append to the READ section of `crmTools` in `crm.tools.ts`:

```ts
  {
    name: 'crm_list_products',
    description: 'List the CRM product catalog (active products) for quoting/analysis.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.CRM.READ,
    module: MODULE_KEYS.CRM,
    inputSchema: z.object({ search: z.string().optional() }),
    run: (args, ctx) => ctx.services.crm.listProducts(ctx.principal.user.tenantId, { ...args, active: 'true' }),
  },
```

- [ ] **Step 3: adapter**

In the `crm: { ... }` adapter in `agents.module.ts` (the factory already injects `products` — add `ProductsService` to its inject + params if not present; `CrmModule` exports it from Task 3, and `AgentsModule` imports `CrmModule`), add:

```ts
          listProducts: (tenantId, query) => products.list(tenantId, query as never),
```

If `ProductsService` is not yet injected into the factory, add it to the provider factory's `inject` array and parameter list (mirror how `DealsService` is injected).

- [ ] **Step 4: e2e**

```ts
// apps/api/test/crm-products.e2e-spec.ts
/**
 * E2E CRM products + line items — product CRUD, line items recompute deal.amount,
 * delete-guard on referenced product, tenant isolation. Seeded DB (tenant acme).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const ADMIN = { email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' };
const uniq = () => Math.random().toString(36).slice(2, 8);

describe('CRM products + line items (e2e)', () => {
  let app: INestApplication; let token: string; let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    prisma = app.get(PrismaService);
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send(ADMIN).expect(200);
    token = login.body.accessToken;
    const tenant = await prisma.tenant.findFirstOrThrow({ where: { slug: 'acme' } });
    const mod = await prisma.moduleDefinition.findFirstOrThrow({ where: { key: 'crm' } });
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId: tenant.id, moduleId: mod.id } },
      update: { enabled: true }, create: { tenantId: tenant.id, moduleId: mod.id, enabled: true, enabledAt: new Date() },
    });
  });
  afterAll(async () => { await app.close(); });
  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('product CRUD + line items recompute deal.amount + delete guard', async () => {
    const srv = app.getHttpServer();
    // product
    const product = (await request(srv).post('/api/v1/crm/products').set(auth()).send({ name: `Prod ${uniq()}`, unitPrice: 100 }).expect(201)).body;
    expect(Number(product.unitPrice)).toBe(100);
    // deal
    const company = (await request(srv).post('/api/v1/crm/companies').set(auth()).send({ name: `Co ${uniq()}` }).expect(201)).body;
    const deal = (await request(srv).post('/api/v1/crm/deals').set(auth()).send({ title: `D ${uniq()}`, companyId: company.id }).expect(201)).body;
    // add 2 lines → amount = 2*100 + 3*50 = 350
    await request(srv).post(`/api/v1/crm/deals/${deal.id}/line-items`).set(auth()).send({ productId: product.id, quantity: 2 }).expect(201);
    const line2 = (await request(srv).post(`/api/v1/crm/deals/${deal.id}/line-items`).set(auth()).send({ name: 'Libre', quantity: 3, unitPrice: 50 }).expect(201)).body;
    let dealRow = (await request(srv).get(`/api/v1/crm/deals/${deal.id}`).set(auth()).expect(200)).body;
    expect(Number(dealRow.amount)).toBe(350);
    // patch line2 qty 3→1 → amount = 200 + 50 = 250
    await request(srv).patch(`/api/v1/crm/deals/${deal.id}/line-items/${line2.id}`).set(auth()).send({ quantity: 1 }).expect(200);
    dealRow = (await request(srv).get(`/api/v1/crm/deals/${deal.id}`).set(auth()).expect(200)).body;
    expect(Number(dealRow.amount)).toBe(250);
    // delete-guard: product referenced → 409
    await request(srv).delete(`/api/v1/crm/products/${product.id}`).set(auth()).expect(409);
    // delete line → amount = 50
    await request(srv).delete(`/api/v1/crm/deals/${deal.id}/line-items/${line2.id}`).set(auth()).expect(200);
    dealRow = (await request(srv).get(`/api/v1/crm/deals/${deal.id}`).set(auth()).expect(200)).body;
    expect(Number(dealRow.amount)).toBe(200);
  });
});
```

(Match the real tenant/module lookup fields against `crm-get-deal.e2e-spec.ts` from the prior cycle — it used `slug`/`moduleDefinition`/`listen(0)`; mirror it.)

- [ ] **Step 5: Run e2e + typecheck**

Run: `pnpm --filter @pulsar/api typecheck && pnpm --filter @pulsar/api test:e2e -- crm-products`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/core/agents/tools/crm.tools.ts apps/api/src/core/agents/tool-types.ts apps/api/src/core/agents/agents.module.ts apps/api/test/crm-products.e2e-spec.ts
git commit -m "feat(crm): crm_list_products tool + products/line-items e2e"
```

---

### Task 6: Web — page catalogue `/crm/products` + nav

**Files:**
- Create: `apps/web/src/routes/(app)/crm/products/+page.svelte`
- Modify: `apps/web/src/lib/modules/navigation.ts`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /crm/products`.

- [ ] **Step 1: Read a reference page**

Read `apps/web/src/routes/(app)/crm/companies/+page.svelte` (or campaigns) for the list+create+edit idiom (`api<T>()` shape, `$state`/`$effect`, error). Reuse it.

- [ ] **Step 2: Build the catalog page**

Create the page: paginated product list (name, sku, unitPrice formatted with currency, active badge), search + active filter, a create/edit form (name, sku, description, unitPrice, currency, active) via a panel/modal consistent with other CRM pages, and delete (handle the 409 "référencé" with an inline error). French labels, loading/empty/error states.

- [ ] **Step 3: Nav entry**

In `navigation.ts`, add "Produits" → `/crm/products` to the CRM section, gated `PERMISSIONS.CRM.READ` (mirror the inbox/companies entries).

- [ ] **Step 4: Build web**

Run: `pnpm --filter @pulsar/web build`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/\(app\)/crm/products/+page.svelte apps/web/src/lib/modules/navigation.ts
git commit -m "feat(web): CRM products catalog page + nav"
```

---

### Task 7: Web — page détail deal `/crm/deals/[id]` avec éditeur de lignes

**Files:**
- Create: `apps/web/src/routes/(app)/crm/deals/[id]/+page.svelte`
- Modify: `apps/web/src/routes/(app)/crm/pipeline/+page.svelte` (card click → detail)
- Modify: `apps/web/src/routes/(app)/crm/deals/+page.svelte` (row click → detail)

**Interfaces:**
- Consumes: `GET /crm/deals/:id`, `GET/POST/PATCH/DELETE /crm/deals/:id/line-items`, `GET /crm/products?active=true` (for the add-from-catalog picker).

- [ ] **Step 1: Read references**

Read `apps/web/src/routes/(app)/crm/companies/[id]/+page.svelte` (detail page idiom with sections, uses `$page.params.id`) and the pipeline page (for the deal shape + currency formatting).

- [ ] **Step 2: Build the deal detail page**

Create `/crm/deals/[id]/+page.svelte`:
- Load the deal (`GET /crm/deals/:id`) — header: title, company name, stage badge, **amount** (the computed total), owner, expected close date. Link "🧠 Coach" → `/crm/coach?dealId=<id>` and a link to the company detail.
- **Line items editor**: load `GET /crm/deals/:id/line-items`; show a table (name, qty, unitPrice, discount %, line total computed client-side or shown from amount). Add line: a picker populated from `GET /crm/products?active=true&pageSize=100` (select a product → POST with productId) OR a "ligne libre" (name + unitPrice). Edit qty/unitPrice/discount inline (PATCH). Delete a line. After each mutation, reload the line items AND the deal header (amount changed server-side).
- French labels; loading/empty/error states; reuse the api()/runes idiom.

- [ ] **Step 3: Repoint card/row clicks to the detail page**

In `crm/pipeline/+page.svelte`, change the card body click target from `/crm/deals` to `/crm/deals/<id>`. In `crm/deals/+page.svelte`, make each row link to `/crm/deals/<id>`.

- [ ] **Step 4: Build web**

Run: `pnpm --filter @pulsar/web build`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/\(app\)/crm/deals/\[id\]/+page.svelte apps/web/src/routes/\(app\)/crm/pipeline/+page.svelte apps/web/src/routes/\(app\)/crm/deals/+page.svelte
git commit -m "feat(web): deal detail page with line-items editor; cards link to it"
```

---

### Task 8: Vérification + docs

**Files:**
- Modify: `docs/etat-du-projet.md`

- [ ] **Step 1: Full verification**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all PASS (shared unit incl. `line-items.spec.ts`).

- [ ] **Step 2: e2e (seeded DB up)**

Run: `pnpm test:e2e`
Expected: existing suites + `crm-products` PASS (1 pre-existing skip acceptable).

- [ ] **Step 3: Docs note**

Add a short French line under the CRM section of `docs/etat-du-projet.md`: catalogue de produits + lignes de produit sur les deals (montant calculé) + page détail deal.

- [ ] **Step 4: Commit**

```bash
git add docs/etat-du-projet.md
git commit -m "docs(crm): note produits + lignes de produit"
```

---

## Self-Review

**Spec coverage:**
- Helpers purs total/somme → Task 1. ✓
- Modèles CrmProduct/CrmDealLineItem + migration + seed → Task 2. ✓
- API catalogue (CRUD + delete-guard) → Task 3. ✓
- API lignes + recompute deal.amount (transaction) → Task 4. ✓
- Outil agent `crm_list_products` + e2e (recompute, delete-guard, isolation) → Task 5. ✓
- Web catalogue + nav → Task 6 ; détail deal + éditeur lignes + repointage clics → Task 7. ✓
- Vérif + docs → Task 8. ✓

**Placeholder scan:** No TODO/TBD. Web tasks (6/7) defer exact markup/`api()` idiom to named existing pages (companies, companies/[id], campaigns) — acceptable: matching established patterns, with endpoints/state spelled out.

**Type consistency:** `sumLineItems` signature (Task 1) matches its caller in `recomputeDealAmount` (Task 4, mapping Decimal→Number). `ProductsService.list` (Task 3) ↔ adapter `crm.listProducts` (Task 5). Line-item DTO fields (`productId/name/quantity/unitPrice/discountPct`) consistent across Task 4 service/controller and Task 7 web. `deal.amount` recompute (Task 4) read unchanged by pipeline/overview (Cycle 1).
