# Fleet Management — Module v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. UI tasks ALSO require a browser inspection (chrome-devtools) as part of done.

**Goal:** Ship the Fleet Management business module v1 — maintenance work orders (with asset-status sync) and compliance/document-expiry tracking on the existing owned-fleet assets, plus a `/fleet` UI section.

**Architecture:** New `apps/api/src/modules/fleet/` module (gated `@RequireModule(FLEET)`) adding `MaintenanceOrder` + `ComplianceDocument` entities and their services over the existing `Vehicle`/`Trailer`/`Driver` assets; pure state machine + compliance helper in `@pulsar/shared`; a `/fleet` SvelteKit section (overview dashboard + asset detail with maintenance + compliance) reusing the existing asset endpoints for the roster.

**Tech Stack:** NestJS 11 + Prisma 6, `@pulsar/shared` (pure, vitest), SvelteKit 5 runes, Jest e2e. Dev servers on :5173/:3000 (DB seeded) for browser verification.

**Design spec:** `docs/superpowers/specs/2026-06-15-fleet-module-v1-design.md`

**Branch:** `fleet-module` (design is its first commit). Do NOT switch branches.

**Conventions (CLAUDE.md):** business-module recipe; enums in `@pulsar/shared` mirrored in `schema.prisma` (rule 3); status via state machines (rule 2); every endpoint `@RequirePermissions(...)` + `@RequireModule(MODULE_KEYS.FLEET)` (rule 5); audit sensitive mutations (rule 6); FK ownership checks (rule 9); files via `DocumentsService` (rule 12); tenant isolation (rule 1). Rebuild shared/database after edits. `pnpm build` + `pnpm test` before green.

**Browser-verification (UI tasks):** dev servers up; chrome-devtools → login admin@pulsar.dev/admin123/acme, ensure FLEET module enabled (via `PATCH /api/v1/modules/fleet` or the modules settings page after reseed), open `/fleet`, exercise the flow, screenshot. NOTE the same infra caveat as before: do NOT run `pnpm --filter @pulsar/api build` while a `nest start --watch` dev process is running (dist clobber). The api is run as a managed `node dist/main` and restarted after a backend rebuild by the controller.

---

## File Structure

**Create (shared):** `packages/shared/src/fleet/maintenance.workflow.ts`, `packages/shared/src/fleet/compliance.ts` (+ specs).
**Create (api):** `apps/api/src/modules/fleet/fleet.module.ts`, `maintenance/maintenance.service.ts` + `dto/maintenance.dto.ts` + `maintenance.controller.ts`, `compliance/compliance.service.ts` + `dto/compliance.dto.ts` + `compliance.controller.ts`, `fleet-overview.controller.ts` (+ a service or method), `*.service.spec.ts`, `apps/api/test/fleet-module.e2e-spec.ts`.
**Create (web):** `apps/web/src/routes/(app)/fleet/+page.svelte` (overview+roster), `apps/web/src/routes/(app)/fleet/vehicles/[id]/+page.svelte` (asset detail; trailers/drivers reuse a shared detail component or analogous pages), `apps/web/src/lib/components/fleet/*` as needed.
**Modify:** `packages/shared/src/modules.ts` (fleet available), `packages/shared/src/permissions.ts` (FLEET perms), `packages/shared/src/index.ts` (exports), `packages/database/prisma/schema.prisma` (+25th migration), `apps/api/src/app.module.ts` (register FleetModule), `apps/web/src/routes/(app)/+layout.svelte` (Fleet nav group), `CLAUDE.md`, `ROADMAP.md`, `docs/etat-du-projet.md`.

---

## Task 1: Shared — maintenance workflow + asset transition

**Files:** Create `packages/shared/src/fleet/maintenance.workflow.ts` + `.spec.ts`; Modify `index.ts`.

- [ ] **Step 1: Write the failing test** — `maintenance.workflow.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MaintenanceOrderStatus, canTransitionMaintenanceOrder, canTransitionAsset } from './maintenance.workflow';

describe('canTransitionMaintenanceOrder', () => {
  it('allows the WO lifecycle', () => {
    expect(canTransitionMaintenanceOrder(MaintenanceOrderStatus.OPEN, MaintenanceOrderStatus.IN_PROGRESS)).toBe(true);
    expect(canTransitionMaintenanceOrder(MaintenanceOrderStatus.OPEN, MaintenanceOrderStatus.COMPLETED)).toBe(true);
    expect(canTransitionMaintenanceOrder(MaintenanceOrderStatus.IN_PROGRESS, MaintenanceOrderStatus.COMPLETED)).toBe(true);
    expect(canTransitionMaintenanceOrder(MaintenanceOrderStatus.OPEN, MaintenanceOrderStatus.CANCELLED)).toBe(true);
    expect(canTransitionMaintenanceOrder(MaintenanceOrderStatus.IN_PROGRESS, MaintenanceOrderStatus.CANCELLED)).toBe(true);
  });
  it('rejects invalid', () => {
    expect(canTransitionMaintenanceOrder(MaintenanceOrderStatus.COMPLETED, MaintenanceOrderStatus.OPEN)).toBe(false);
    expect(canTransitionMaintenanceOrder(MaintenanceOrderStatus.CANCELLED, MaintenanceOrderStatus.COMPLETED)).toBe(false);
  });
});

describe('canTransitionAsset', () => {
  it('AVAILABLE/IN_SERVICE → MAINTENANCE, MAINTENANCE → AVAILABLE', () => {
    expect(canTransitionAsset('AVAILABLE', 'MAINTENANCE')).toBe(true);
    expect(canTransitionAsset('IN_SERVICE', 'MAINTENANCE')).toBe(true);
    expect(canTransitionAsset('MAINTENANCE', 'AVAILABLE')).toBe(true);
  });
  it('never disturbs RETIRED', () => {
    expect(canTransitionAsset('RETIRED', 'MAINTENANCE')).toBe(false);
    expect(canTransitionAsset('RETIRED', 'AVAILABLE')).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm --filter @pulsar/shared test -- maintenance.workflow`.

- [ ] **Step 3: Implement `maintenance.workflow.ts`**:

```ts
// Pure. Mirrored in packages/database schema.prisma (fleet module).

export enum MaintenanceType { PREVENTIVE = 'PREVENTIVE', REPAIR = 'REPAIR', INSPECTION = 'INSPECTION' }

export enum MaintenanceOrderStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

const WO: Record<MaintenanceOrderStatus, MaintenanceOrderStatus[]> = {
  [MaintenanceOrderStatus.OPEN]: [MaintenanceOrderStatus.IN_PROGRESS, MaintenanceOrderStatus.COMPLETED, MaintenanceOrderStatus.CANCELLED],
  [MaintenanceOrderStatus.IN_PROGRESS]: [MaintenanceOrderStatus.COMPLETED, MaintenanceOrderStatus.CANCELLED],
  [MaintenanceOrderStatus.COMPLETED]: [],
  [MaintenanceOrderStatus.CANCELLED]: [],
};

export function canTransitionMaintenanceOrder(from: MaintenanceOrderStatus, to: MaintenanceOrderStatus): boolean {
  if (from === to) return true;
  return (WO[from] ?? []).includes(to);
}

/**
 * AssetStatus transitions driven by the maintenance workflow (string values mirror the Prisma
 * AssetStatus enum). RETIRED is terminal — never disturbed by maintenance. Used by the fleet
 * service to flip a vehicle/trailer in/out of MAINTENANCE (rule 2).
 */
const ASSET: Record<string, string[]> = {
  AVAILABLE: ['MAINTENANCE', 'IN_SERVICE', 'RETIRED'],
  IN_SERVICE: ['MAINTENANCE', 'AVAILABLE', 'RETIRED'],
  MAINTENANCE: ['AVAILABLE', 'IN_SERVICE', 'RETIRED'],
  RETIRED: [],
};

export function canTransitionAsset(from: string, to: string): boolean {
  if (from === to) return true;
  return (ASSET[from] ?? []).includes(to);
}
```

- [ ] **Step 4: Export** — in `packages/shared/src/index.ts` add `export * from './fleet/maintenance.workflow';`.

- [ ] **Step 5: Run + build** — `pnpm --filter @pulsar/shared test -- maintenance.workflow` PASS; `pnpm --filter @pulsar/shared build` clean.

- [ ] **Step 6: Commit**
```bash
git add packages/shared/src/fleet/maintenance.workflow.ts packages/shared/src/fleet/maintenance.workflow.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): maintenance + asset state machines (fleet)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Shared — compliance status helper

**Files:** Create `packages/shared/src/fleet/compliance.ts` + `.spec.ts`; Modify `index.ts`.

- [ ] **Step 1: Write the failing test** — `compliance.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeComplianceStatus, ComplianceSubject, ComplianceDocType } from './compliance';

const NOW = new Date('2026-06-15T00:00:00.000Z').getTime();
const days = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

describe('computeComplianceStatus', () => {
  it('EXPIRED when past', () => {
    expect(computeComplianceStatus(days(-1), NOW)).toBe('EXPIRED');
  });
  it('EXPIRING within the warn window (default 30d)', () => {
    expect(computeComplianceStatus(days(10), NOW)).toBe('EXPIRING');
    expect(computeComplianceStatus(days(30), NOW)).toBe('EXPIRING');
  });
  it('VALID beyond the window', () => {
    expect(computeComplianceStatus(days(60), NOW)).toBe('VALID');
  });
  it('respects a custom warn window', () => {
    expect(computeComplianceStatus(days(10), NOW, 7)).toBe('VALID');
  });
  it('exposes the enums', () => {
    expect(Object.values(ComplianceSubject)).toEqual(['VEHICLE', 'TRAILER', 'DRIVER']);
    expect(Object.values(ComplianceDocType)).toContain('INSURANCE');
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm --filter @pulsar/shared test -- compliance.spec`.

- [ ] **Step 3: Implement `compliance.ts`**:

```ts
// Pure, browser-safe. Mirrored in packages/database schema.prisma (fleet module).

export enum ComplianceSubject { VEHICLE = 'VEHICLE', TRAILER = 'TRAILER', DRIVER = 'DRIVER' }
export enum ComplianceDocType {
  REGISTRATION = 'REGISTRATION',
  INSURANCE = 'INSURANCE',
  INSPECTION = 'INSPECTION',
  LICENSE = 'LICENSE',
  MEDICAL = 'MEDICAL',
  OTHER = 'OTHER',
}

export type ComplianceStatus = 'VALID' | 'EXPIRING' | 'EXPIRED';

/** Expired if past; expiring if within `warnDays`; else valid. Pure. */
export function computeComplianceStatus(expiresAt: string | Date, now: number, warnDays = 30): ComplianceStatus {
  const exp = typeof expiresAt === 'string' ? new Date(expiresAt).getTime() : expiresAt.getTime();
  if (exp < now) return 'EXPIRED';
  if (exp <= now + warnDays * 86_400_000) return 'EXPIRING';
  return 'VALID';
}
```

- [ ] **Step 4: Export** — in `index.ts` add `export * from './fleet/compliance';`.

- [ ] **Step 5: Run + build** — test PASS; `pnpm --filter @pulsar/shared build` clean.

- [ ] **Step 6: Commit**
```bash
git add packages/shared/src/fleet/compliance.ts packages/shared/src/fleet/compliance.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): compliance status + enums (fleet)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Shared — module activation + permissions

**Files:** Modify `packages/shared/src/modules.ts`, `packages/shared/src/permissions.ts`.

- [ ] **Step 1: Activate the module** — in `modules.ts`, the `fleet` catalog entry: change `available: false` → `available: true`.

- [ ] **Step 2: Permissions** — in `permissions.ts`:
- Add a `FLEET` group to the `PERMISSIONS` map (after `BILLING`):
```ts
  FLEET: {
    READ: 'fleet.read',
    MANAGE: 'fleet.manage',
  },
```
- Add a `fleet` catalog helper near the `billing` one:
```ts
const fleet = (key: PermissionKey, description: string): PermissionDescriptor => ({ key, module: MODULE_KEYS.FLEET, description });
```
(match the exact shape of the existing `billing` helper — module key + description.)
- Add 2 catalog entries with the other module catalog lines:
```ts
  fleet(PERMISSIONS.FLEET.READ, 'View fleet assets, maintenance and compliance'),
  fleet(PERMISSIONS.FLEET.MANAGE, 'Manage maintenance orders and compliance documents'),
```

- [ ] **Step 3: Build** — `pnpm --filter @pulsar/shared build` clean. `grep -n "fleet.read\|FLEET:" packages/shared/src/permissions.ts` shows them.

- [ ] **Step 4: Commit**
```bash
git add packages/shared/src/modules.ts packages/shared/src/permissions.ts
git commit -m "feat(shared): activate fleet module + fleet.read|manage permissions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Prisma — MaintenanceOrder + ComplianceDocument (25th migration)

**Files:** Modify `packages/database/prisma/schema.prisma`.

READ the existing `Vehicle`/`Trailer`/`Tenant` models for relation/back-relation conventions. The shared enums (`MaintenanceType`, `MaintenanceOrderStatus`, `ComplianceSubject`, `ComplianceDocType`) must be mirrored here with identical names (rule 3).

- [ ] **Step 1: Add enums** (near the fleet/asset section):
```prisma
enum MaintenanceType { PREVENTIVE REPAIR INSPECTION }
enum MaintenanceOrderStatus { OPEN IN_PROGRESS COMPLETED CANCELLED }
enum ComplianceSubject { VEHICLE TRAILER DRIVER }
enum ComplianceDocType { REGISTRATION INSURANCE INSPECTION LICENSE MEDICAL OTHER }
```

- [ ] **Step 2: Add models**:
```prisma
model MaintenanceOrder {
  id            String                 @id @default(cuid())
  tenantId      String
  vehicleId     String?
  trailerId     String?
  type          MaintenanceType        @default(REPAIR)
  status        MaintenanceOrderStatus @default(OPEN)
  description   String
  odometerKm    Int?
  costAmount    Decimal?               @db.Decimal(12, 2)
  costCurrency  String                 @default("CAD")
  vendor        String?
  dueDate       DateTime?
  dueOdometerKm Int?
  openedAt      DateTime               @default(now())
  completedAt   DateTime?
  createdById   String?
  createdAt     DateTime               @default(now())
  updatedAt     DateTime               @updatedAt

  tenant  Tenant   @relation(fields: [tenantId], references: [id])
  vehicle Vehicle? @relation(fields: [vehicleId], references: [id])
  trailer Trailer? @relation(fields: [trailerId], references: [id])

  @@index([tenantId, status])
  @@index([tenantId, vehicleId])
  @@map("maintenance_orders")
}

model ComplianceDocument {
  id          String            @id @default(cuid())
  tenantId    String
  subjectType ComplianceSubject
  subjectId   String
  docType     ComplianceDocType
  reference   String?
  issuedAt    DateTime?
  expiresAt   DateTime
  documentId  String?
  notes       String?
  createdById String?
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@index([tenantId, subjectType, subjectId])
  @@index([tenantId, expiresAt])
  @@map("compliance_documents")
}
```
(`subjectId` is a soft polymorphic FK — no Prisma relation; ownership checked in-service.)

- [ ] **Step 3: Back-relations** — add to `model Tenant`: `maintenanceOrders MaintenanceOrder[]` and `complianceDocuments ComplianceDocument[]`. Add to `model Vehicle`: `maintenanceOrders MaintenanceOrder[]`. Add to `model Trailer`: `maintenanceOrders MaintenanceOrder[]`.

- [ ] **Step 4: Migrate + build + reseed** (DB up):
```bash
cd packages/database
pnpm exec dotenv -e ../../.env -- prisma migrate dev --name fleet_module
cd ../..
pnpm --filter @pulsar/database build
cd "$(git rev-parse --show-toplevel)" && pnpm db:seed
```
Expected: one migration `*_fleet_module` (4 CREATE TYPE + 2 CREATE TABLE + FKs + indexes); build clean; reseed picks up the 2 fleet permissions (assigned to admin role) and the fleet module catalog row. If drift/reset prompted, STOP and report.

- [ ] **Step 5: Commit**
```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): MaintenanceOrder + ComplianceDocument + fleet enums (25th migration)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: API — MaintenanceService (+ asset sync) + controller

**Files:** Create `apps/api/src/modules/fleet/maintenance/maintenance.service.ts` + `dto/maintenance.dto.ts` + `maintenance.controller.ts` + `maintenance.service.spec.ts`.

READ `apps/api/src/modules/billing/invoices.service.ts` (TOCTOU conditional-updateMany pattern), `apps/api/src/prisma/ownership.service.ts` (`assertOwnedIfSet`), and `apps/api/src/modules/transportation/vehicles/vehicles.controller.ts` (controller style + decorators).

- [ ] **Step 1: DTOs** — `dto/maintenance.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { MaintenanceType } from '@pulsar/shared';

export class CreateMaintenanceOrderDto {
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() trailerId?: string;
  @IsEnum(MaintenanceType) type!: MaintenanceType;
  @IsString() @MinLength(1) description!: string;
  @IsOptional() @IsInt() odometerKm?: number;
  @IsOptional() @IsString() vendor?: string;
  @IsOptional() @Type(() => Date) dueDate?: Date;
  @IsOptional() @IsInt() dueOdometerKm?: number;
}

export class CompleteMaintenanceOrderDto {
  @IsOptional() @IsNumber() costAmount?: number;
  @IsOptional() @IsString() costCurrency?: string;
  @IsOptional() @IsInt() odometerKm?: number;
}

export class MaintenanceListQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() trailerId?: string;
}
```

- [ ] **Step 2: Write the failing test** — `maintenance.service.spec.ts`:
```ts
import { MaintenanceOrderStatus, MaintenanceType } from '@pulsar/shared';
import { MaintenanceService } from './maintenance.service';

function harness(assetStatus = 'AVAILABLE') {
  const vehicle = { id: 'v1', tenantId: 't1', status: assetStatus };
  const wo: any = { id: 'wo1', tenantId: 't1', vehicleId: 'v1', trailerId: null, status: MaintenanceOrderStatus.OPEN };
  const calls: any = { vehicleUpdates: [] };
  const prisma = {
    vehicle: { findFirst: async () => vehicle, updateMany: async ({ data }: any) => { calls.vehicleUpdates.push(data); Object.assign(vehicle, data); return { count: 1 }; } },
    trailer: { findFirst: async () => null },
    maintenanceOrder: {
      create: async ({ data }: any) => { Object.assign(wo, data); return wo; },
      findFirst: async () => wo,
      updateMany: async ({ where, data }: any) => { if (where.status === undefined || wo.status === where.status || (where.status?.in ?? []).includes(wo.status)) { Object.assign(wo, data); return { count: 1 }; } return { count: 0 }; },
    },
  } as any;
  const ownership = { assertOwnedIfSet: async () => undefined } as any;
  const audit = { log: async () => undefined } as any;
  return { svc: new MaintenanceService(prisma, ownership, audit), vehicle, wo, calls };
}

describe('MaintenanceService', () => {
  it('create on a vehicle flips it to MAINTENANCE', async () => {
    const h = harness('AVAILABLE');
    await h.svc.create('t1', 'u1', { vehicleId: 'v1', type: MaintenanceType.REPAIR, description: 'brakes' } as any);
    expect(h.vehicle.status).toBe('MAINTENANCE');
  });
  it('complete returns the vehicle to AVAILABLE + sets cost/completedAt', async () => {
    const h = harness('MAINTENANCE');
    await h.svc.complete('t1', 'u1', 'wo1', { costAmount: 250 } as any);
    expect(h.wo.status).toBe(MaintenanceOrderStatus.COMPLETED);
    expect(h.vehicle.status).toBe('AVAILABLE');
  });
  it('rejects a create with neither vehicle nor trailer', async () => {
    const h = harness();
    await expect(h.svc.create('t1', 'u1', { type: MaintenanceType.REPAIR, description: 'x' } as any)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run → FAIL** — `pnpm --filter @pulsar/api test -- maintenance.service`.

- [ ] **Step 4: Implement `maintenance.service.ts`** — methods: `list(tenantId, query)`, `get`, `create` (validate exactly-one-asset via `(!!vehicleId !== !!trailerId)`, `assertOwnedIfSet` the asset, create the WO OPEN, then flip the asset to MAINTENANCE if `canTransitionAsset(asset.status, 'MAINTENANCE')`, audit), `start` (OPEN→IN_PROGRESS, conditional updateMany + `canTransitionMaintenanceOrder`), `complete` (→COMPLETED, set completedAt + cost + odometer, then return the asset to AVAILABLE if `canTransitionAsset(status,'AVAILABLE')`, audit), `cancel` (→CANCELLED, return asset to AVAILABLE if it was MAINTENANCE, audit). Each transition: `canTransitionMaintenanceOrder` guard + conditional `updateMany` (TOCTOU) + audit (rule 6). Asset flip: read the asset, guard with `canTransitionAsset`, `updateMany({where:{id,tenantId,status:<current>}, data:{status:<next>}})`, audit. Tenant-scope everything (rule 1). Constructor injects `(prisma, ownership: OwnershipService, audit: AuditLogsService)`.

> Asset helper (private): `private async setAssetStatus(tenantId, vehicleId|null, trailerId|null, next): Promise<void>` — loads the relevant asset, if `canTransitionAsset(current, next)` updates it (guarded, never touches RETIRED) + audits. Reused by create/complete/cancel.

- [ ] **Step 5: Controller** — `maintenance.controller.ts`, `@ApiTags('fleet/maintenance')` `@RequireModule(MODULE_KEYS.FLEET)` `@Controller('fleet/maintenance-orders')`: `GET` (list, fleet.read), `GET :id` (read), `POST` (create, manage, `@Audit('maintenance-order', CREATE)`), `POST :id/start` `POST :id/complete` `POST :id/cancel` (manage). Mirror `vehicles.controller.ts` decorator imports.

- [ ] **Step 6: Run test + build** — `pnpm --filter @pulsar/api test -- maintenance.service` PASS; `pnpm --filter @pulsar/api build` clean (service compiles even before module wiring — Task 7 registers it).

- [ ] **Step 7: Commit**
```bash
git add apps/api/src/modules/fleet/maintenance/
git commit -m "feat(api): MaintenanceService — work orders + asset-status sync

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: API — ComplianceService + FleetOverview + controllers

**Files:** Create `apps/api/src/modules/fleet/compliance/compliance.service.ts` + `dto/compliance.dto.ts` + `compliance.controller.ts`, `apps/api/src/modules/fleet/fleet-overview.controller.ts`; Test `compliance.service.spec.ts`.

READ `DocumentsService` (rule 12) for the file link (the `documentId` is just stored; upload flow is the existing documents endpoint — v1 only stores an optional `documentId`).

- [ ] **Step 1: DTOs** — `dto/compliance.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ComplianceDocType, ComplianceSubject } from '@pulsar/shared';

export class CreateComplianceDocumentDto {
  @IsEnum(ComplianceSubject) subjectType!: ComplianceSubject;
  @IsString() subjectId!: string;
  @IsEnum(ComplianceDocType) docType!: ComplianceDocType;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @Type(() => Date) issuedAt?: Date;
  @Type(() => Date) expiresAt!: Date;
  @IsOptional() @IsString() documentId?: string;
  @IsOptional() @IsString() notes?: string;
}
```

- [ ] **Step 2: Write the failing test** — `compliance.service.spec.ts`:
```ts
import { ComplianceDocType, ComplianceSubject } from '@pulsar/shared';
import { ComplianceService } from './compliance.service';

function harness() {
  const docs: any[] = [];
  const prisma = {
    vehicle: { findFirst: async () => ({ id: 'v1', tenantId: 't1' }) },
    trailer: { findFirst: async () => null },
    driver: { findFirst: async () => null },
    complianceDocument: {
      create: async ({ data }: any) => { const d = { id: `d${docs.length+1}`, ...data }; docs.push(d); return d; },
      findMany: async () => docs,
      findFirst: async () => docs[0] ?? null,
    },
  } as any;
  const ownership = {} as any;
  const audit = { log: async () => undefined } as any;
  const documents = {} as any;
  return { svc: new ComplianceService(prisma, audit, documents), docs };
}

describe('ComplianceService', () => {
  it('creates a compliance doc for an owned vehicle', async () => {
    const h = harness();
    const d = await h.svc.create('t1', 'u1', { subjectType: ComplianceSubject.VEHICLE, subjectId: 'v1', docType: ComplianceDocType.INSURANCE, expiresAt: new Date('2026-12-31') } as any);
    expect(d.id).toBe('d1');
    expect(h.docs).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run → FAIL** — `pnpm --filter @pulsar/api test -- compliance.service`.

- [ ] **Step 4: Implement `compliance.service.ts`** — `create` (validate the `subjectId` is an owned asset of `subjectType`: switch on subjectType → `prisma.{vehicle|trailer|driver}.findFirst({where:{id:subjectId,tenantId}})`, throw NotFound if absent; persist; audit), `list(tenantId, {subjectType?, subjectId?})` (tenant-scoped, ordered expiresAt asc), `get`, `remove(tenantId,id)` (delete, audit), `expiring(tenantId, days)` (`expiresAt <= now+days`, tenant-scoped, ordered). Return rows AS-IS; the computed status is derived client-side OR add a small mapper using `computeComplianceStatus` server-side for the overview. Constructor `(prisma, audit: AuditLogsService, documents: DocumentsService)`.

- [ ] **Step 5: FleetOverview** — `fleet-overview.controller.ts` (or a method on a service): `GET /fleet/overview` (fleet.read) → `{ openWorkOrders: number, maintenanceDue: MaintenanceOrder[] (status OPEN/IN_PROGRESS or dueDate<=+7d), compliance: { expiring: ComplianceDocument[] (computeComplianceStatus EXPIRING), expired: [...] } }`. Compute on read (query maintenance_orders + compliance_documents, tenant-scoped, map compliance via `computeComplianceStatus(doc.expiresAt, Date.now())`). Keep it a focused read.

- [ ] **Step 6: Compliance controller** — `compliance.controller.ts`, `@RequireModule(FLEET)` `@Controller('fleet/compliance-documents')`: `GET` (list, ?subjectType&subjectId&expiringDays), `GET :id`, `POST` (manage, `@Audit('compliance-document', CREATE)`), `DELETE :id` (manage). fleet.read on GETs.

- [ ] **Step 7: Run test + build** — `pnpm --filter @pulsar/api test -- compliance.service` PASS; build clean.

- [ ] **Step 8: Commit**
```bash
git add apps/api/src/modules/fleet/compliance/ apps/api/src/modules/fleet/fleet-overview.controller.ts
git commit -m "feat(api): ComplianceService + fleet overview (expiry tracking)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: API — FleetModule wiring + app registration

**Files:** Create `apps/api/src/modules/fleet/fleet.module.ts`; Modify `apps/api/src/app.module.ts`.

- [ ] **Step 1: FleetModule** — providers: `MaintenanceService`, `ComplianceService` (+ overview service if separate); controllers: `MaintenanceController`, `ComplianceController`, `FleetOverviewController`; imports: `AuditLogsModule`, the module that provides `OwnershipService` + `DocumentsService` (check how transportation/billing import them — likely `PrismaModule` is @Global for prisma+ownership; `DocumentsModule` for DocumentsService). Mirror an existing module's imports.
```ts
@Module({
  imports: [AuditLogsModule, DocumentsModule],
  controllers: [MaintenanceController, ComplianceController, FleetOverviewController],
  providers: [MaintenanceService, ComplianceService],
})
export class FleetModule {}
```
(Adjust imports to satisfy `OwnershipService`/`DocumentsService` DI — verify against how billing/transportation get them; PrismaService/OwnershipService come via the global Prisma module if that's the pattern.)

- [ ] **Step 2: Register** — in `app.module.ts`, add `FleetModule` to the `imports` array (next to `BillingModule`).

- [ ] **Step 3: Build + DI boot check** — `pnpm --filter @pulsar/api build` clean. Boot-check: run an existing e2e to confirm the app boots with FleetModule: `pnpm --filter @pulsar/api test:e2e -- phase16-freight-audit` (PASS). If a provider can't resolve (OwnershipService/DocumentsService), fix the FleetModule imports.

- [ ] **Step 4: Commit**
```bash
git add apps/api/src/modules/fleet/fleet.module.ts apps/api/src/app.module.ts
git commit -m "feat(api): register FleetModule

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Fleet e2e

**Files:** Create `apps/api/test/fleet-module.e2e-spec.ts`.

Reuse a prior bootstrap (phase16/dispatch e2e). Ensure acme has FLEET enabled (the reseed in Task 4 added the catalog row; enable via prisma upsert on the tenantModule for the fleet moduleDefinition, like the phase16 e2e enabled billing). Seed a `Vehicle` (own fleet, status AVAILABLE) for acme.

- [ ] **Step 1: Scenarios** (supertest, admin Bearer):
1. **module gating**: with FLEET disabled, `GET /api/v1/fleet/overview` → 403/404. Enable FLEET → 200. (Or assert enabled-path only if toggling is heavy; at minimum prove the enabled path works.)
2. **maintenance lifecycle + asset sync**: `POST /fleet/maintenance-orders {vehicleId, type:'REPAIR', description}` → 201 OPEN; `GET /transportation/vehicles/:id` → status MAINTENANCE. `POST /fleet/maintenance-orders/:id/complete {costAmount:250, odometerKm:120000}` → COMPLETED; vehicle back to AVAILABLE; WO has completedAt + cost.
3. **exactly-one-asset**: `POST` with neither vehicleId nor trailerId → 400; with both → 400.
4. **compliance + overview**: `POST /fleet/compliance-documents {subjectType:'VEHICLE', subjectId:<v>, docType:'INSURANCE', expiresAt:<+10d>}` → 201; `GET /fleet/overview` → `compliance.expiring` includes it; a doc with expiresAt +60d is NOT in expiring.
5. **isolation**: compliance create with a subjectId of another tenant's vehicle → 404; maintenance on another tenant's vehicle → 404.

- [ ] **Step 2: Run** — `pnpm db:migrate && pnpm db:seed` if needed; `pnpm --filter @pulsar/api test:e2e -- fleet-module` all pass (run 2×). Regression: `pnpm --filter @pulsar/api test:e2e -- phase16-freight-audit dispatch-workbench fleet-module`.

- [ ] **Step 3: Commit**
```bash
git add apps/api/test/fleet-module.e2e-spec.ts
git commit -m "test(api): fleet e2e — maintenance lifecycle + asset sync, compliance overview, gating, isolation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Web — Fleet nav + `/fleet` overview & roster

**Files:** Modify `apps/web/src/routes/(app)/+layout.svelte`; Create `apps/web/src/routes/(app)/fleet/+page.svelte`.

READ `+layout.svelte` (the `groups`/`hasBilling` gating pattern) + an existing list page for conventions.

- [ ] **Step 1: Nav** — add `hasFleet = $derived($auth?.tenant.enabledModules.includes(MODULE_KEYS.FLEET) ?? false)` and a nav group `{ label: 'Fleet', visible: hasFleet, items: [{ href: '/fleet', label: 'Fleet overview' }] }` (and a palette command). Match the existing group structure.

- [ ] **Step 2: `/fleet/+page.svelte`** — `GET /fleet/overview` → attention cards (open work orders count, maintenance due list, compliance expiring/expired lists with the colored status); + asset roster reusing `GET /transportation/vehicles?pageSize=100` (+ trailers/drivers) showing unitNumber/type/status badge, each linking to `/fleet/vehicles/{id}`. Reuse Card/Badge; `api()`; loading/empty states; French copy. (Roster requires the tenant to also have TRANSPORTATION + master-data.read — acceptable v1; if the call 403s, show a hint.)

- [ ] **Step 3: Build + typecheck + BROWSER VERIFY** — build/typecheck clean; chrome-devtools: ensure FLEET enabled (via `/settings/modules` toggle or prisma), open `/fleet`, confirm the overview + roster render. Screenshot.

- [ ] **Step 4: Commit**
```bash
git add "apps/web/src/routes/(app)/+layout.svelte" "apps/web/src/routes/(app)/fleet/+page.svelte"
git commit -m "feat(web): Fleet nav + overview dashboard + asset roster

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Web — asset detail (maintenance + compliance)

**Files:** Create `apps/web/src/routes/(app)/fleet/vehicles/[id]/+page.svelte` (+ analogous trailers/drivers, or a shared `$lib/components/fleet/AssetDetail.svelte` used by all three).

- [ ] **Step 1: Asset detail page** — loads the asset (`GET /transportation/vehicles/:id`), its maintenance orders (`GET /fleet/maintenance-orders?vehicleId=:id`), and its compliance docs (`GET /fleet/compliance-documents?subjectType=VEHICLE&subjectId=:id`). Render:
  - Asset header (unitNumber, type, status badge).
  - **Maintenance**: list of WOs (type, status, description, cost, odometer, dates) + a "Nouvel ordre" form (type/description/odometer/vendor/dueDate → `POST /fleet/maintenance-orders {vehicleId,...}`) + per-WO actions Démarrer/Compléter (cost+odometer)/Annuler (`POST :id/start|complete|cancel`). Refresh after.
  - **Conformité**: list of docs with colored status (compute `computeComplianceStatus` client-side, or display a server-provided status) + "Ajouter un document" form (docType/reference/issuedAt/expiresAt → `POST /fleet/compliance-documents`) + delete. Refresh.
  - `loading`/`disabled` on action buttons; `toast` on results.
- Use Svelte 5 runes + design system. Trailers/drivers: either analogous pages or the shared component parameterized by subjectType + asset endpoint (drivers have no maintenance/AssetStatus — for drivers show only compliance). Keep v1 focused: full maintenance+compliance for vehicles/trailers; compliance-only for drivers.

- [ ] **Step 2: Build + typecheck + BROWSER VERIFY** — open a vehicle from `/fleet` roster → create a WO → confirm the vehicle status flips to MAINTENANCE (on the page + roster) → complete it → back to AVAILABLE; add a compliance doc with a near expiry → it shows EXPIRING and appears on `/fleet` overview. Screenshot the populated asset detail.

- [ ] **Step 3: Commit**
```bash
git add "apps/web/src/routes/(app)/fleet/vehicles/[id]/+page.svelte" apps/web/src/lib/components/fleet/
git commit -m "feat(web): fleet asset detail — maintenance work orders + compliance documents

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Rule 32 + docs + full verification

**Files:** `CLAUDE.md`, `ROADMAP.md`, `docs/etat-du-projet.md`.

- [ ] **Step 1: Hard rule 32 in `CLAUDE.md`** — after the phase-15/16 rule blocks, add the "## Hard rules (continued, fleet)" block with rule 32 verbatim from the design spec §F.

- [ ] **Step 2: `ROADMAP.md`** — Acte III: mark Fleet Management v1 ✅ shipped (asset registry reuse + maintenance work orders with asset-status sync + compliance/expiry + `/fleet` UI; 25th migration; rule 32), note remaining fleet slices (recurring schedules, DVIR inspections, fleet analytics) + the next module (Light WMS).

- [ ] **Step 3: `docs/etat-du-projet.md`** — note Fleet Management module v1 shipped; migrations 24→25; modules live now 4 (Transportation, Customer Portal, Billing, Fleet). Match the doc format.

- [ ] **Step 4: Full verification**
```bash
pnpm build
pnpm test
pnpm --filter @pulsar/api test:e2e -- phase16-freight-audit dispatch-workbench fleet-module
```
All pass. Plus a final browser pass of `/fleet`. If anything fails, STOP and report BLOCKED.

- [ ] **Step 5: Commit**
```bash
git add CLAUDE.md ROADMAP.md docs/etat-du-projet.md
git commit -m "docs(fleet): hard rule 32 + roadmap/status — Fleet Management module v1 shipped

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (completed during planning)

**Spec coverage:** module activation + perms (Task 3); maintenance entity/workflow/asset-sync (Tasks 1,4,5); compliance entity/compute/expiry (Tasks 2,4,6); overview dashboard (Task 6,9); fleet UI roster + asset detail (Tasks 9,10); module wiring/gating (Task 7); rule 32 (Task 11); tests unit (1,2,5,6) + e2e (8) + browser (9,10). ✅

**Placeholder scan:** Task 5's `setAssetStatus` and Task 6's overview are specified with the exact guard/shape (canTransitionAsset, computeComplianceStatus); Task 10 scopes drivers to compliance-only (explicit). No "TBD". The FleetModule imports (Task 7) say "verify how billing/transportation get OwnershipService/DocumentsService" — that's a read-existing-pattern instruction, not a vague placeholder.

**Type consistency:** `MaintenanceOrderStatus`/`MaintenanceType`/`canTransitionMaintenanceOrder`/`canTransitionAsset` (Task 1) used in Tasks 4/5. `ComplianceSubject`/`ComplianceDocType`/`computeComplianceStatus` (Task 2) used in 4/6. `MaintenanceService`/`ComplianceService` constructor signatures consistent between service (5/6), module (7), and specs. Endpoints (`/fleet/maintenance-orders`, `/fleet/compliance-documents`, `/fleet/overview`) consistent across controller (5/6), e2e (8), web (9/10). `FLEET.READ/MANAGE` perms consistent (3/5/6).

**Known/flagged:** the Fleet asset roster reuses `transportation/*` endpoints (gated TRANSPORTATION + master-data perms) — a Fleet-only tenant without Transportation couldn't load the roster; acceptable for v1 (Fleet tenants have Transportation), noted in Task 9. The asset-status flip never touches RETIRED (canTransitionAsset) and only flips guarded — no brutal overwrite. `subjectId` polymorphic FK has no DB constraint; ownership checked in-service per subjectType (Task 6).
```
