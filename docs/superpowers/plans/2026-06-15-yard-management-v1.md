# Yard Management v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Yard Management business module — a live yard board (spots: dock doors / parking / staging), gate check-in/out, yard moves (logged), and dock appointments.

**Architecture:** A new gated module `apps/api/src/modules/yard`. `YardVisit` is the spine (CHECKED_IN→ASSIGNED→DEPARTED via a pure state machine); spot occupancy is DERIVED (a spot is occupied if an active visit points to it); every position change writes a `YardMove` in the same transaction. `DockAppointment` is a parallel scheduled-slot entity a visit can fulfill. Sites/spots reuse `Location`. Web adds a "Yard" nav group with a board, a gate workbench, appointments, and spots master-data.

**Tech Stack:** NestJS + Prisma (`@pulsar/database`), `@pulsar/shared` (pure, vitest), SvelteKit 5 runes (ssr=false), jest e2e in `apps/api/test`.

**Templates to mirror (just shipped, analogous):** the **WMS** and **Fleet** modules — `apps/api/src/modules/wms/**` (esp. `picking/picking.service.ts` for transition+claim+transaction, `wms.module.ts` for wiring, `overview/` for board-style read service), `packages/shared/src/wms/wms.workflow.ts` (enums + canTransition pattern), web `apps/web/src/routes/(app)/wms/**` (dashboard + workbenches + master-data + nav group in `+layout.svelte`). The WMS↔shipment link migration shows the FK pattern.

**Infra notes (Windows):**
- Run API as detached `node dist/main.js`; after any API rebuild kill the port-3000 PID and restart. NEVER `pnpm --filter @pulsar/api build` while `pnpm dev` (nest watch) runs.
- After a Prisma migration, kill the detached API (DLL lock) before `pnpm db:generate`. Migrate via the repo's wrapper: `pnpm --filter @pulsar/database exec dotenv -e ../../.env -- prisma migrate dev --name <name>` (proven for WMS).
- Rebuild `@pulsar/shared` / `@pulsar/database` after changing them. List endpoints cap pageSize at 100. `api()` tolerates empty 200/201 bodies (void POST actions are fine).
- DATABASE_URL for ad-hoc scripts: `DATABASE_URL=$(grep ^DATABASE_URL= .env | cut -d= -f2- | tr -d '"')`.

---

## File Structure

**`packages/shared/src/yard/`** (new): `yard.workflow.ts` (enums + `canTransitionYardVisit`, `canTransitionDockAppointment`, `isSpotOccupied`) + `yard.workflow.spec.ts`. Export from `packages/shared/src/index.ts`.

**`packages/shared/src/`** (modify): `modules.ts` (flip `yard.available`), `permissions.ts` (YARD group + catalog).

**`packages/database/prisma/schema.prisma`** (modify): 4 enums + 4 models (`YardSpot`, `YardVisit`, `YardMove`, `DockAppointment`) + back-relations on Tenant/Location/Trailer/Carrier.

**`apps/api/src/modules/yard/`** (new):
- `spots/` — `dto/spot.dto.ts`, `spots.service.ts`, `spots.controller.ts`.
- `visits/` — `dto/visit.dto.ts`, `visits.service.ts`, `visits.service.spec.ts`, `visits.controller.ts`.
- `appointments/` — `dto/appointment.dto.ts`, `appointments.service.ts`, `appointments.service.spec.ts`, `appointments.controller.ts`.
- `overview/` — `yard-overview.service.ts`, `yard-overview.controller.ts`.
- `yard.module.ts`; register in `app.module.ts`.

**`apps/api/test/yard-module.e2e-spec.ts`** (new).

**`apps/web/src/routes/(app)/`** (new): `yard/+page.svelte` (board), `yard/gate/+page.svelte`, `yard/appointments/+page.svelte`, `yard/spots/+page.svelte`; `+layout.svelte` (modify: Yard nav group).

**Docs** (modify): `CLAUDE.md` (rule 34), `docs/etat-du-projet.md`.

---

## Task 1: Shared — yard workflows

**Files:**
- Create: `packages/shared/src/yard/yard.workflow.ts`
- Create: `packages/shared/src/yard/yard.workflow.spec.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test** — `packages/shared/src/yard/yard.workflow.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  DockAppointmentStatus,
  YardVisitStatus,
  canTransitionDockAppointment,
  canTransitionYardVisit,
  isSpotOccupied,
} from './yard.workflow';

describe('canTransitionYardVisit', () => {
  it('allows the yard lifecycle', () => {
    expect(canTransitionYardVisit(YardVisitStatus.CHECKED_IN, YardVisitStatus.ASSIGNED)).toBe(true);
    expect(canTransitionYardVisit(YardVisitStatus.ASSIGNED, YardVisitStatus.CHECKED_IN)).toBe(true);
    expect(canTransitionYardVisit(YardVisitStatus.CHECKED_IN, YardVisitStatus.DEPARTED)).toBe(true);
    expect(canTransitionYardVisit(YardVisitStatus.ASSIGNED, YardVisitStatus.DEPARTED)).toBe(true);
    expect(canTransitionYardVisit(YardVisitStatus.CHECKED_IN, YardVisitStatus.CANCELLED)).toBe(true);
  });
  it('is a no-op when from===to', () => {
    expect(canTransitionYardVisit(YardVisitStatus.ASSIGNED, YardVisitStatus.ASSIGNED)).toBe(true);
  });
  it('rejects out of terminal states', () => {
    expect(canTransitionYardVisit(YardVisitStatus.DEPARTED, YardVisitStatus.ASSIGNED)).toBe(false);
    expect(canTransitionYardVisit(YardVisitStatus.CANCELLED, YardVisitStatus.CHECKED_IN)).toBe(false);
  });
});

describe('canTransitionDockAppointment', () => {
  it('allows the appointment lifecycle', () => {
    expect(canTransitionDockAppointment(DockAppointmentStatus.SCHEDULED, DockAppointmentStatus.ARRIVED)).toBe(true);
    expect(canTransitionDockAppointment(DockAppointmentStatus.ARRIVED, DockAppointmentStatus.COMPLETED)).toBe(true);
    expect(canTransitionDockAppointment(DockAppointmentStatus.SCHEDULED, DockAppointmentStatus.CANCELLED)).toBe(true);
    expect(canTransitionDockAppointment(DockAppointmentStatus.SCHEDULED, DockAppointmentStatus.NO_SHOW)).toBe(true);
  });
  it('rejects COMPLETED→anything and ARRIVED→NO_SHOW', () => {
    expect(canTransitionDockAppointment(DockAppointmentStatus.COMPLETED, DockAppointmentStatus.CANCELLED)).toBe(false);
    expect(canTransitionDockAppointment(DockAppointmentStatus.ARRIVED, DockAppointmentStatus.NO_SHOW)).toBe(false);
  });
});

describe('isSpotOccupied', () => {
  it('is occupied when an active visit is present', () => {
    expect(isSpotOccupied([YardVisitStatus.ASSIGNED])).toBe(true);
    expect(isSpotOccupied([YardVisitStatus.CHECKED_IN])).toBe(true);
  });
  it('is free when empty or only terminal visits', () => {
    expect(isSpotOccupied([])).toBe(false);
    expect(isSpotOccupied([YardVisitStatus.DEPARTED, YardVisitStatus.CANCELLED])).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @pulsar/shared test -- yard.workflow`

- [ ] **Step 3: Implement** `packages/shared/src/yard/yard.workflow.ts`:
```ts
export enum YardSpotType {
  DOCK_DOOR = 'DOCK_DOOR',
  PARKING = 'PARKING',
  STAGING = 'STAGING',
}

export enum YardDirection {
  INBOUND = 'INBOUND',
  OUTBOUND = 'OUTBOUND',
  OTHER = 'OTHER',
}

export enum YardVisitStatus {
  CHECKED_IN = 'CHECKED_IN',
  ASSIGNED = 'ASSIGNED',
  DEPARTED = 'DEPARTED',
  CANCELLED = 'CANCELLED',
}

export enum DockAppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  ARRIVED = 'ARRIVED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
}

const VISIT_TRANSITIONS: Record<YardVisitStatus, YardVisitStatus[]> = {
  [YardVisitStatus.CHECKED_IN]: [YardVisitStatus.ASSIGNED, YardVisitStatus.DEPARTED, YardVisitStatus.CANCELLED],
  [YardVisitStatus.ASSIGNED]: [YardVisitStatus.CHECKED_IN, YardVisitStatus.DEPARTED, YardVisitStatus.CANCELLED],
  [YardVisitStatus.DEPARTED]: [],
  [YardVisitStatus.CANCELLED]: [],
};

export function canTransitionYardVisit(from: YardVisitStatus, to: YardVisitStatus): boolean {
  if (from === to) return true;
  return VISIT_TRANSITIONS[from]?.includes(to) ?? false;
}

const APPOINTMENT_TRANSITIONS: Record<DockAppointmentStatus, DockAppointmentStatus[]> = {
  [DockAppointmentStatus.SCHEDULED]: [DockAppointmentStatus.ARRIVED, DockAppointmentStatus.CANCELLED, DockAppointmentStatus.NO_SHOW],
  [DockAppointmentStatus.ARRIVED]: [DockAppointmentStatus.COMPLETED, DockAppointmentStatus.CANCELLED],
  [DockAppointmentStatus.COMPLETED]: [],
  [DockAppointmentStatus.CANCELLED]: [],
  [DockAppointmentStatus.NO_SHOW]: [],
};

export function canTransitionDockAppointment(from: DockAppointmentStatus, to: DockAppointmentStatus): boolean {
  if (from === to) return true;
  return APPOINTMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/** A spot is occupied if any visit pointing to it is in a non-terminal status. */
export function isSpotOccupied(visitStatuses: YardVisitStatus[]): boolean {
  return visitStatuses.some((s) => s === YardVisitStatus.CHECKED_IN || s === YardVisitStatus.ASSIGNED);
}
```

- [ ] **Step 4: Export** — in `packages/shared/src/index.ts` add `export * from './yard/yard.workflow';` (next to the wms/fleet exports).

- [ ] **Step 5: Run → PASS + rebuild.** `pnpm --filter @pulsar/shared test -- yard.workflow` → PASS; `pnpm --filter @pulsar/shared build` → clean.

- [ ] **Step 6: Commit**
```bash
git add packages/shared/src/yard packages/shared/src/index.ts
git commit -m "feat(shared): yard workflows (visit/appointment transitions) + isSpotOccupied"
```

---

## Task 2: Module activation + permissions

**Files:** Modify `packages/shared/src/modules.ts`, `packages/shared/src/permissions.ts`.

- [ ] **Step 1:** In `modules.ts`, the `MODULE_CATALOG` entry `key: MODULE_KEYS.YARD` → set `available: true`.
- [ ] **Step 2:** In `permissions.ts`, MIRROR the WMS block exactly (read it first). Add to the PERMISSIONS group: `YARD: { READ: 'yard.read', MANAGE: 'yard.manage' },`. Add the helper `const yard = (key, description) => ({ key, module: MODULE_KEYS.YARD, description })` and the 2 catalog entries:
  - `yard(PERMISSIONS.YARD.READ, 'View yard spots, visits and dock appointments')`
  - `yard(PERMISSIONS.YARD.MANAGE, 'Manage yard spots, gate check-in/out, moves and appointments')`
  Extend the `PermissionKey` union the same way WMS did (`(typeof PERMISSIONS.YARD)[keyof typeof PERMISSIONS.YARD]`).
- [ ] **Step 3:** `pnpm --filter @pulsar/shared build` → clean.
- [ ] **Step 4: Commit**
```bash
git add packages/shared/src/modules.ts packages/shared/src/permissions.ts
git commit -m "feat(shared): activate yard module + yard.read/manage permissions"
```

---

## Task 3: Prisma models + migration

**Files:** Modify `packages/database/prisma/schema.prisma`.

- [ ] **Step 1: Add enums** (mirror shared exactly — rule 3):
```prisma
enum YardSpotType { DOCK_DOOR PARKING STAGING }
enum YardDirection { INBOUND OUTBOUND OTHER }
enum YardVisitStatus { CHECKED_IN ASSIGNED DEPARTED CANCELLED }
enum DockAppointmentStatus { SCHEDULED ARRIVED COMPLETED CANCELLED NO_SHOW }
```

- [ ] **Step 2: Add models**
```prisma
model YardSpot {
  id         String       @id @default(cuid())
  tenantId   String
  locationId String
  code       String
  type       YardSpotType @default(PARKING)
  isActive   Boolean      @default(true)
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt

  tenant       Tenant            @relation(fields: [tenantId], references: [id])
  location     Location          @relation(fields: [locationId], references: [id])
  visits       YardVisit[]
  appointments DockAppointment[]
  movesFrom    YardMove[]        @relation("YardMoveFrom")
  movesTo      YardMove[]        @relation("YardMoveTo")

  @@unique([tenantId, locationId, code])
  @@index([tenantId, locationId])
  @@map("yard_spots")
}

model YardVisit {
  id            String          @id @default(cuid())
  tenantId      String
  visitNumber   String
  locationId    String
  trailerId     String?
  trailerRef    String?
  carrierId     String?
  driverName    String?
  direction     YardDirection   @default(OTHER)
  status        YardVisitStatus @default(CHECKED_IN)
  spotId        String?
  appointmentId String?
  checkInAt     DateTime        @default(now())
  checkOutAt    DateTime?
  notes         String?
  createdById   String?
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  tenant      Tenant           @relation(fields: [tenantId], references: [id])
  location    Location         @relation(fields: [locationId], references: [id])
  trailer     Trailer?         @relation(fields: [trailerId], references: [id])
  carrier     Carrier?         @relation(fields: [carrierId], references: [id])
  spot        YardSpot?        @relation(fields: [spotId], references: [id])
  appointment DockAppointment? @relation(fields: [appointmentId], references: [id])
  moves       YardMove[]

  @@unique([tenantId, visitNumber])
  @@index([tenantId, status])
  @@index([tenantId, spotId])
  @@map("yard_visits")
}

model YardMove {
  id          String   @id @default(cuid())
  tenantId    String
  visitId     String
  fromSpotId  String?
  toSpotId    String?
  movedAt     DateTime @default(now())
  note        String?
  createdById String?

  tenant  Tenant    @relation(fields: [tenantId], references: [id])
  visit   YardVisit @relation(fields: [visitId], references: [id], onDelete: Cascade)
  fromSpot YardSpot? @relation("YardMoveFrom", fields: [fromSpotId], references: [id])
  toSpot   YardSpot? @relation("YardMoveTo", fields: [toSpotId], references: [id])

  @@index([tenantId, visitId])
  @@map("yard_moves")
}

model DockAppointment {
  id                String                @id @default(cuid())
  tenantId          String
  appointmentNumber String
  locationId        String
  spotId            String?
  carrierId         String?
  direction         YardDirection         @default(INBOUND)
  windowStart       DateTime
  windowEnd         DateTime
  reference         String?
  status            DockAppointmentStatus @default(SCHEDULED)
  notes             String?
  createdById       String?
  createdAt         DateTime              @default(now())
  updatedAt         DateTime              @updatedAt

  tenant   Tenant      @relation(fields: [tenantId], references: [id])
  location Location    @relation(fields: [locationId], references: [id])
  spot     YardSpot?   @relation(fields: [spotId], references: [id])
  carrier  Carrier?    @relation(fields: [carrierId], references: [id])
  visits   YardVisit[]

  @@unique([tenantId, appointmentNumber])
  @@index([tenantId, status])
  @@index([tenantId, windowStart])
  @@map("dock_appointments")
}
```

- [ ] **Step 3: Back-relations** — add to:
  - `model Tenant`: `yardSpots YardSpot[]`, `yardVisits YardVisit[]`, `yardMoves YardMove[]`, `dockAppointments DockAppointment[]`
  - `model Location`: `yardSpots YardSpot[]`, `yardVisits YardVisit[]`, `dockAppointments DockAppointment[]`
  - `model Trailer`: `yardVisits YardVisit[]`
  - `model Carrier`: `yardVisits YardVisit[]`, `dockAppointments DockAppointment[]`

- [ ] **Step 4: Kill API, migrate, generate**
```bash
# free port 3000 (PowerShell Stop-Process the listener PID)
pnpm --filter @pulsar/database exec dotenv -e ../../.env -- prisma migrate dev --name yard_module
pnpm db:generate
```
Expected: migration `*_yard_module`; client has `yardSpot`, `yardVisit`, `yardMove`, `dockAppointment` delegates.

- [ ] **Step 5: Rebuild db + reseed**
```bash
pnpm --filter @pulsar/database build
pnpm db:seed   # picks up yard.read/manage perms + yard module
```

- [ ] **Step 6: Commit**
```bash
git add packages/database/prisma/schema.prisma packages/database/prisma/migrations
git commit -m "feat(db): Yard models (spots, visits, moves, dock appointments)"
```

---

## Task 4: SpotsService + AppointmentsService (master-data + scheduling) + controllers

**Files:**
- Create: `apps/api/src/modules/yard/spots/dto/spot.dto.ts`, `spots.service.ts`, `spots.controller.ts`
- Create: `apps/api/src/modules/yard/appointments/dto/appointment.dto.ts`, `appointments.service.ts`, `appointments.service.spec.ts`, `appointments.controller.ts`

**Read first:** `apps/api/src/modules/wms/bins/bins.service.ts` (CRUD + location-belongs-to-tenant check + P2002→Conflict), `apps/api/src/modules/wms/picking/picking.service.ts` (transition + conditional `updateMany` claim + audit + sequences), `apps/api/src/core/audit-logs/audit-logs.service.ts` (`log(entry)` object shape), `apps/api/src/prisma/sequences.service.ts` (add a `'dock-appointment'`→`'DA'` SequenceKey here, mirroring how `'receipt'`/`'pick-order'` were added).

- [ ] **Step 1: Spot DTOs** — `spots/dto/spot.dto.ts`:
```ts
import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { YardSpotType } from '@pulsar/shared';

export class CreateSpotDto {
  @IsString() @MinLength(1) locationId!: string;
  @IsString() @MinLength(1) code!: string;
  @IsOptional() @IsEnum(YardSpotType) type?: YardSpotType;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateSpotDto extends PartialType(CreateSpotDto) {}
export class SpotListQueryDto {
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsEnum(YardSpotType) type?: YardSpotType;
}
```

- [ ] **Step 2: SpotsService** — constructor `(prisma, ownership)`. `list` (filter locationId/type, take 200, include location {id,code,name}), `get` (NotFound), `create` (validate `locationId` is a tenant Location via `findFirst` → NotFound else; create; P2002→`ConflictException('Spot code already exists at this location')`), `update` (ensure exists, updateMany {id,tenantId}, return get). All tenant-scoped.

- [ ] **Step 3: SpotsController** — `@ApiTags('yard/spots')`, `@RequireModule(MODULE_KEYS.YARD)`, `@Controller('yard/spots')`. GET list/`:id` READ; POST MANAGE + `@Audit('yard-spot', AuditAction.CREATE)`; PATCH `:id` MANAGE + `@Audit('yard-spot', AuditAction.UPDATE)`. Decorator import paths identical to `wms/bins/bins.controller.ts`.

- [ ] **Step 4: Appointment DTOs** — `appointments/dto/appointment.dto.ts`:
```ts
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { YardDirection } from '@pulsar/shared';

export class CreateAppointmentDto {
  @IsString() @MinLength(1) locationId!: string;
  @IsOptional() @IsString() spotId?: string;
  @IsOptional() @IsString() carrierId?: string;
  @IsOptional() @IsEnum(YardDirection) direction?: YardDirection;
  @Type(() => Date) @IsDate() windowStart!: Date;
  @Type(() => Date) @IsDate() windowEnd!: Date;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() notes?: string;
}
export class AppointmentListQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() locationId?: string;
}
```
NOTE the `@IsDate()` on the date fields — REQUIRED (the WMS bug: `@Type` alone gets stripped by the whitelist ValidationPipe → 400).

- [ ] **Step 5: AppointmentsService spec** — `appointments.service.spec.ts`:
```ts
import { DockAppointmentStatus } from '@pulsar/shared';
import { AppointmentsService } from './appointments.service';

function harness(status = DockAppointmentStatus.SCHEDULED) {
  const appt: any = { id: 'a1', tenantId: 't1', status };
  const prisma = {
    location: { findFirst: async () => ({ id: 'loc1', tenantId: 't1' }) },
    dockAppointment: {
      findFirst: async () => appt,
      updateMany: async ({ where, data }: any) => { const ok = where.status === appt.status || (where.status?.in ?? []).includes(appt.status); if (ok) { Object.assign(appt, data); return { count: 1 }; } return { count: 0 }; },
    },
  } as any;
  const sequences = { nextNumber: async () => 'DA-0001' } as any;
  const ownership = { assertOwnedIfSet: async () => undefined } as any;
  const audit = { log: async () => undefined } as any;
  return { svc: new AppointmentsService(prisma, sequences, ownership, audit), appt };
}

describe('AppointmentsService transitions', () => {
  it('arrive flips SCHEDULED→ARRIVED', async () => {
    const h = harness();
    await h.svc.arrive('t1', 'u1', 'a1');
    expect(h.appt.status).toBe(DockAppointmentStatus.ARRIVED);
  });
  it('complete from ARRIVED', async () => {
    const h = harness(DockAppointmentStatus.ARRIVED);
    await h.svc.complete('t1', 'u1', 'a1');
    expect(h.appt.status).toBe(DockAppointmentStatus.COMPLETED);
  });
  it('rejects completing a SCHEDULED appointment', async () => {
    const h = harness(DockAppointmentStatus.SCHEDULED);
    await expect(h.svc.complete('t1', 'u1', 'a1')).rejects.toThrow();
  });
});
```

- [ ] **Step 6: Run → FAIL.** `pnpm --filter @pulsar/api test -- appointments.service`

- [ ] **Step 7: AppointmentsService** — constructor `(prisma, sequences: SequencesService, ownership, audit)`. Import `canTransitionDockAppointment`, `DockAppointmentStatus` from `@pulsar/shared`; `AuditAction`.
  - `list(tenantId, q)`: findMany where tenantId + optional status/locationId, orderBy windowStart asc, take 100, include spot/carrier projections.
  - `get(tenantId, id)`: findFirst + NotFound.
  - `create(tenantId, userId, dto)`: validate location is tenant's (findFirst); if `windowEnd <= windowStart` → `BadRequestException`; `assertOwnedIfSet` carrier/spot OR explicit tenant findFirst; `number = nextNumber(tenantId, 'dock-appointment')`; create (status SCHEDULED); audit CREATE.
  - private `transition(tenantId, userId, id, to, extra?)`: load (NotFound); guard `canTransitionDockAppointment(status, to)` else `BadRequestException`; `updateMany({ where: { id, tenantId, status: <current> }, data: { status: to, ...extra } })`; if count 0 → `ConflictException`; audit.
  - `arrive`/`complete`/`cancel`/`noShow` call `transition(...)` with ARRIVED/COMPLETED/CANCELLED/NO_SHOW.

- [ ] **Step 8: AppointmentsController** — `@Controller('yard/appointments')`, `@RequireModule(YARD)`: GET list/`:id` READ; POST MANAGE `@Audit('dock-appointment', CREATE)`; `@Post(':id/arrive'|':id/complete'|':id/cancel'|':id/no-show')` MANAGE.

- [ ] **Step 9: Run tests + build** — `pnpm --filter @pulsar/api test -- appointments.service` → PASS; `pnpm --filter @pulsar/api build` → clean.

- [ ] **Step 10: Commit**
```bash
git add apps/api/src/modules/yard/spots apps/api/src/modules/yard/appointments apps/api/src/prisma/sequences.service.ts
git commit -m "feat(api): yard spots master-data + dock appointments (scheduling + transitions)"
```

---

## Task 5: VisitsService — gate check-in/out + assign/move (occupancy + move log)

**Files:**
- Create: `apps/api/src/modules/yard/visits/dto/visit.dto.ts`, `visits.service.ts`, `visits.service.spec.ts`, `visits.controller.ts`

**Read first:** `apps/api/src/modules/wms/inventory/inventory.service.ts` (the `$transaction` + `postMovement` writes-a-log-row-in-the-same-tx pattern — `assignToSpot` mirrors it), `picking.service.ts` (claim + transition + audit + sequences). The appointment-link uses `AppointmentsService` OR a direct `dockAppointment.updateMany` to ARRIVED — to avoid a cross-service dep, do the appointment ARRIVED flip with a direct guarded `updateMany` inside the transaction (mirror the transition guard).

- [ ] **Step 1: Visit DTOs** — `visits/dto/visit.dto.ts`:
```ts
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { YardDirection } from '@pulsar/shared';

export class CheckInDto {
  @IsString() @MinLength(1) locationId!: string;
  @IsOptional() @IsString() trailerId?: string;
  @IsOptional() @IsString() trailerRef?: string;
  @IsOptional() @IsString() carrierId?: string;
  @IsOptional() @IsString() driverName?: string;
  @IsOptional() @IsEnum(YardDirection) direction?: YardDirection;
  @IsOptional() @IsString() spotId?: string;        // optional immediate assignment
  @IsOptional() @IsString() appointmentId?: string; // optional fulfilled appointment
  @IsOptional() @IsString() notes?: string;
}
export class AssignSpotDto {
  @IsString() @MinLength(1) spotId!: string;
  @IsOptional() @IsString() note?: string;
}
export class VisitListQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() spotId?: string;
}
```

- [ ] **Step 2: Write the failing test** — `visits.service.spec.ts`:
```ts
import { YardVisitStatus } from '@pulsar/shared';
import { VisitsService } from './visits.service';

function harness(opts: { occupied?: boolean } = {}) {
  const visit: any = { id: 'v1', tenantId: 't1', status: YardVisitStatus.CHECKED_IN, spotId: null };
  const moves: any[] = [];
  const client = {
    yardVisit: {
      findFirst: async () => visit,
      count: async ({ where }: any) => (opts.occupied && where.spotId === 'door1' ? 1 : 0),
      updateMany: async ({ where, data }: any) => { const ok = where.status === undefined || where.status === visit.status || (where.status?.in ?? []).includes(visit.status); if (ok) { Object.assign(visit, data); return { count: 1 }; } return { count: 0 }; },
    },
    yardMove: { create: async ({ data }: any) => { moves.push(data); return { id: 'm' + moves.length, ...data }; } },
    $transaction: async (fn: any) => fn(client),
  } as any;
  const sequences = { nextNumber: async () => 'YV-0001' } as any;
  const ownership = { assertOwnedIfSet: async () => undefined } as any;
  const audit = { log: async () => undefined } as any;
  return { svc: new VisitsService(client, sequences, ownership, audit), visit, moves };
}

describe('VisitsService.assign', () => {
  it('assigns a free spot: writes a YardMove + flips to ASSIGNED + sets spotId', async () => {
    const h = harness();
    await h.svc.assign('t1', 'u1', 'v1', { spotId: 'door1' } as any);
    expect(h.visit.status).toBe(YardVisitStatus.ASSIGNED);
    expect(h.visit.spotId).toBe('door1');
    expect(h.moves[0].toSpotId).toBe('door1');
  });
  it('rejects assigning an occupied spot', async () => {
    const h = harness({ occupied: true });
    await expect(h.svc.assign('t1', 'u1', 'v1', { spotId: 'door1' } as any)).rejects.toThrow();
  });
});

describe('VisitsService.checkOut', () => {
  it('flips to DEPARTED, frees the spot, logs a move', async () => {
    const h = harness();
    h.visit.spotId = 'door1'; h.visit.status = YardVisitStatus.ASSIGNED;
    await h.svc.checkOut('t1', 'u1', 'v1');
    expect(h.visit.status).toBe(YardVisitStatus.DEPARTED);
    expect(h.visit.spotId).toBeNull();
    expect(h.moves.at(-1).toSpotId).toBeNull();
  });
});
```

- [ ] **Step 3: Run → FAIL.** `pnpm --filter @pulsar/api test -- visits.service`

- [ ] **Step 4: Implement `visits.service.ts`** — constructor `(prisma: PrismaService, sequences: SequencesService, ownership: OwnershipService, audit: AuditLogsService)`. Import `canTransitionYardVisit`, `YardVisitStatus`, `DockAppointmentStatus`, `canTransitionDockAppointment` from `@pulsar/shared`; `AuditAction`.
  - private `assertActiveVisit(tenantId, id)`: findFirst {id,tenantId}; NotFound if absent; return it.
  - private async `assignToSpot(tx, tenantId, userId, visit, toSpotId, note?)`:
    - guard `canTransitionYardVisit(visit.status, ASSIGNED)` else `BadRequestException`.
    - occupancy: `const occ = await tx.yardVisit.count({ where: { tenantId, spotId: toSpotId, status: { in: [CHECKED_IN, ASSIGNED] }, id: { not: visit.id } } }); if (occ > 0) throw new ConflictException('Spot already occupied');`
    - `await tx.yardMove.create({ data: { tenantId, visitId: visit.id, fromSpotId: visit.spotId ?? null, toSpotId, createdById: userId, note: note ?? null } });`
    - `await tx.yardVisit.updateMany({ where: { id: visit.id, tenantId }, data: { spotId: toSpotId, status: ASSIGNED } });`
  - `checkIn(tenantId, userId, dto)`: validate location is tenant's; `assertOwnedIfSet` trailer/carrier/spot (or explicit findFirst per entity for tenant) ; `number = nextNumber(tenantId, 'yard-visit')`; in a `$transaction`: create visit (CHECKED_IN, checkInAt now, fields from dto except spotId); if `dto.appointmentId` → load appt {id,tenantId,status}, guard `canTransitionDockAppointment(status, ARRIVED)`, `updateMany({where:{id,tenantId,status:'SCHEDULED'},data:{status:'ARRIVED'}})` (ignore count race), set visit.appointmentId; if `dto.spotId` → `assignToSpot(tx, ..., createdVisit, dto.spotId)`. Return the visit (reload via get). Audit CREATE.
    (Simplify: create the visit first in the tx, then optionally assign.)
  - `assign(tenantId, userId, visitId, dto: AssignSpotDto)`: load active visit; `$transaction(tx => assignToSpot(tx, tenantId, userId, visit, dto.spotId, dto.note))`; audit; return get. `move` is an alias of `assign` (same logic — moving = assigning to a new spot; the from/to are captured in the YardMove).
  - `checkOut(tenantId, userId, visitId)`: load; guard `canTransitionYardVisit(status, DEPARTED)`; `$transaction`: `claim = updateMany({ where: { id, tenantId, status: { in: [CHECKED_IN, ASSIGNED] } }, data: { status: DEPARTED, checkOutAt: new Date(), spotId: null } })`; if count 0 → Conflict; `yardMove.create({ data: { tenantId, visitId, fromSpotId: visit.spotId ?? null, toSpotId: null, createdById: userId } })`. Audit.
  - `cancel(tenantId, userId, visitId)`: guard → CANCELLED; claim updateMany (status in [CHECKED_IN, ASSIGNED]) data {status: CANCELLED, spotId: null}; audit.
  - `get(tenantId, id)`: findFirst include trailer {unitNumber,plate}, carrier {name}, spot {code,type}, appointment {appointmentNumber}.
  - `list(tenantId, q)`: findMany filters, orderBy checkInAt desc, take 100, same includes.

- [ ] **Step 5: Run → PASS.** `pnpm --filter @pulsar/api test -- visits.service`

- [ ] **Step 6: VisitsController** — `@Controller('yard/visits')`, `@RequireModule(YARD)`: GET list/`:id` READ; `@Post()` MANAGE `@Audit('yard-visit', CREATE)` checkIn; `@Post(':id/assign')` + `@Post(':id/move')` MANAGE (body AssignSpotDto); `@Post(':id/check-out')` MANAGE; `@Post(':id/cancel')` MANAGE.

- [ ] **Step 7: Build + commit**
```bash
pnpm --filter @pulsar/api build
git add apps/api/src/modules/yard/visits
git commit -m "feat(api): yard visits — gate check-in/out, assign/move (occupancy + move log)"
```

---

## Task 6: YardOverviewService + module wiring

**Files:**
- Create: `apps/api/src/modules/yard/overview/yard-overview.service.ts`, `yard-overview.controller.ts`
- Create: `apps/api/src/modules/yard/yard.module.ts`; Modify `apps/api/src/app.module.ts`

**Read first:** `apps/api/src/modules/wms/overview/wms-overview.service.ts`, `apps/api/src/modules/wms/wms.module.ts`.

- [ ] **Step 1: YardOverviewService** — constructor `(prisma)`.
  - `overview(tenantId)`: Promise.all of: `yardVisit.count` active (status in [CHECKED_IN, ASSIGNED]); `yardSpot.count` DOCK_DOOR; occupied doors = `yardVisit.count({ where: { tenantId, status: { in: [CHECKED_IN, ASSIGNED] }, spot: { type: 'DOCK_DOOR' } } })` (distinct spots — count visits, acceptable v1); `visitsWithoutSpot` = active visits with `spotId: null`; `appointmentsToday` = `dockAppointment.count` with windowStart in [today, tomorrow) and status SCHEDULED/ARRIVED. Return the object (freeDoors = doorCount - occupiedDoors).
  - `board(tenantId, locationId?)`: load spots (`where tenantId + optional locationId`, include the active visit pointing to each via a separate query OR `visits: { where: { status: { in: [CHECKED_IN, ASSIGNED] } }, include: { trailer, carrier } }`); also fetch active visits with `spotId: null` (the to-place queue). Return `{ spots: [...with occupyingVisit], unassigned: [...] }`.

- [ ] **Step 2: YardOverviewController** — `@Controller('yard')`, `@RequireModule(YARD)`: `@Get('overview')` READ; `@Get('board')` READ (`@Query('locationId') locationId?`).

- [ ] **Step 3: `yard.module.ts`** (mirror wms.module.ts): `imports: [AuditLogsModule]`; controllers [Spots, Visits, Appointments, YardOverview]; providers [SpotsService, VisitsService, AppointmentsService, YardOverviewService]. (PrismaService + SequencesService + OwnershipService are global.)

- [ ] **Step 4: Register in `app.module.ts`** — add `YardModule` near `WmsModule`.

- [ ] **Step 5: Build + boot smoke** — `pnpm --filter @pulsar/api build` → clean. If port 3000 free, boot ~6s, confirm `/api/v1/yard/...` routes mapped + `Nest application successfully started`, kill it.

- [ ] **Step 6: Commit**
```bash
git add apps/api/src/modules/yard/overview apps/api/src/modules/yard/yard.module.ts apps/api/src/app.module.ts
git commit -m "feat(api): yard overview + board; wire YardModule"
```

---

## Task 7: E2e — the yard loop

**Files:** Create `apps/api/test/yard-module.e2e-spec.ts`.

**Read first:** `apps/api/test/wms-module.e2e-spec.ts` (bootstrap, login, enable module via Prisma upsert, Location creation via `POST /transportation/locations`, unique codes, afterAll cleanup). A Trailer can be created via `POST /api/v1/transportation/trailers` (carrierId omitted = internal); a Carrier via the carriers endpoint if needed (or omit — visit carrier is optional).

- [ ] **Step 1: Write the suite.** `beforeAll`: bootstrap, login admin acme; enable YARD + TRANSPORTATION; create a `Location` (a site, any type, unique code); create 2 `YardSpot` via `POST /yard/spots` (one DOCK_DOOR `DOOR-1`, one PARKING `P-1`); optionally a Trailer.
  Tests:
  1. **check-in** `POST /yard/visits { locationId, trailerRef:'ABC123', direction:'INBOUND' }` → 201, status CHECKED_IN.
  2. **assign to a door** `POST /yard/visits/:id/assign { spotId: door }` → status ASSIGNED; `GET /yard/board?locationId=` shows the visit occupying DOOR-1.
  3. **occupancy** check-in a 2nd visit; `POST /yard/visits/:id2/assign { spotId: door }` → **409**.
  4. **move** assign visit1 to P-1 → board shows it on P-1, DOOR-1 free; a `YardMove` recorded (assert via board or that re-assigning door now succeeds for visit2).
  5. **check-out** `POST /yard/visits/:id/check-out` → DEPARTED; board no longer shows it.
  6. **appointment** `POST /yard/appointments { locationId, windowStart, windowEnd, direction:'INBOUND' }` → SCHEDULED; `POST /yard/appointments/:id/arrive` → ARRIVED; check-in a visit with `appointmentId` → the appointment is ARRIVED (already) and visit links it.
  7. **tenant isolation** + **module gating**: skip-with-comment per the WMS suite convention (or assert list scoping).
  Use ISO dates; filter to created ids; afterAll cleanup.

- [ ] **Step 2: Run until GREEN.** `pnpm --filter @pulsar/api test:e2e -- yard-module`. Fix any real bug in service/controller (not the test) and note it.

- [ ] **Step 3: Commit**
```bash
git add apps/api/test/yard-module.e2e-spec.ts
git add -A apps/api/src/modules/yard
git commit -m "test(api): yard e2e — check-in/assign/move/check-out, occupancy 409, appointment link"
```

---

## Task 8: Web — Yard board + gate + appointments + spots + nav

**Files:**
- Create: `apps/web/src/routes/(app)/yard/+page.svelte` (board), `yard/gate/+page.svelte`, `yard/appointments/+page.svelte`, `yard/spots/+page.svelte`
- Modify: `apps/web/src/routes/(app)/+layout.svelte`

**Read first:** `apps/web/src/routes/(app)/wms/+page.svelte` (dashboard cards), `wms/fulfillment/+page.svelte` (queue + row actions), `wms/receiving/+page.svelte` (list+detail two-pane + create modal + line forms), `wms/bins/+page.svelte` (master-data with location picker), `+layout.svelte` (Warehouse nav group). Locations come from `GET /transportation/locations?pageSize=100`. Trailers from `GET /transportation/trailers?pageSize=100`.

- [ ] **Step 1: Nav** — add a **"Yard"** group (gated `hasYard = enabledModules.includes(MODULE_KEYS.YARD)`), entries: `Yard → /yard`, `Gate → /yard/gate`, `Rendez-vous → /yard/appointments`, `Spots → /yard/spots`.

- [ ] **Step 2: `/yard/+page.svelte` (board)** — site selector (locations); `GET /yard/board?locationId=` + `GET /yard/overview`. Cards (camions en cour, portes occupées/libres, rendez-vous du jour). Spots grid grouped by type (DOCK_DOOR/PARKING/STAGING): each spot card shows code + occupant (visit n°, trailerRef/trailer unit, carrier, direction) or "Libre"; occupied = warn tone, free = ok/neutral. A side list "À placer" (unassigned active visits) with an **Affecter** action (pick a free spot → `POST /yard/visits/:id/assign`). On an occupied spot: **Déplacer** (assign to another free spot) + **Check-out** (`POST /yard/visits/:id/check-out`). Reload after actions; toast.

- [ ] **Step 3: `/yard/gate/+page.svelte`** — check-in form (site, trailer Fleet select OR free-text trailerRef, carrier optional, direction, optional spot, optional appointment) → `POST /yard/visits`; list of active visits (`GET /yard/visits?status=...` — or fetch CHECKED_IN+ASSIGNED) with Check-out buttons.

- [ ] **Step 4: `/yard/appointments/+page.svelte`** — list (`GET /yard/appointments`, sorted by window, status badge) + create modal (site, spot optional, carrier optional, direction, windowStart/windowEnd datetime, reference) → `POST /yard/appointments`; row actions Arrive/Complete/Cancel/No-show. Use `@IsDate`-friendly ISO datetime-local inputs.

- [ ] **Step 5: `/yard/spots/+page.svelte`** — spots CRUD (list filterable by site; create/edit modal: site picker, code, type select DOCK_DOOR/PARKING/STAGING, isActive). Mirror `wms/bins`.

- [ ] **Step 6: check + build** — `pnpm --filter @pulsar/web typecheck` → 0 errors; `pnpm --filter @pulsar/web build` → clean.

- [ ] **Step 7: Commit**
```bash
git add "apps/web/src/routes/(app)/yard" "apps/web/src/routes/(app)/+layout.svelte"
git commit -m "feat(web): Yard board + gate + appointments + spots master-data"
```

(Browser verification is Task 9 by the controller.)

---

## Task 9: Browser verification + rule 34 + docs + full build

**Files:** Modify `CLAUDE.md` (rule 34), `docs/etat-du-projet.md`.

- [ ] **Step 1: Restart API + web up.** Kill port-3000 PID, `pnpm --filter @pulsar/api build`, start detached `node dist/main.js`, wait for 401 on `/api/v1/modules`. Web on :5173.

- [ ] **Step 2: Browser-verify (chrome-devtools)** — login admin@pulsar.dev / admin123 / acme. Use the existing `WH-MTL` site (or create a site). Create 2 spots (a DOCK_DOOR + a PARKING) via `/yard/spots`. On `/yard/gate`: check in a visit (free-text trailer). On `/yard`: confirm it appears "À placer"; assign it to the door → confirm it occupies the door; create + check in a 2nd visit, try to assign it to the same door → confirm a 409 toast; move visit1 to parking → door frees; check-out → leaves the board. On `/yard/appointments`: create an appointment, arrive it. Screenshot. **Fix any real bug found.**

- [ ] **Step 3: Rule 34 in CLAUDE.md** — append a new section after the WMS rule block (before "## Adding a business module"), verbatim from the spec §F:
```markdown
## Hard rules (continued, module Yard)

34. (module Yard — cour & quais) Le statut d'une `YardVisit`/`DockAppointment` ne change QUE via
    `canTransitionYardVisit`/`canTransitionDockAppointment` (`@pulsar/shared/yard`, règle 2) avec claim
    conditionnel `updateMany` (TOCTOU). Un spot occupé (visite active CHECKED_IN/ASSIGNED dessus) ne peut
    recevoir une autre visite : refus 409 ; l'occupation est DÉRIVÉE (count des visites actives sur le spot),
    jamais dénormalisée. Tout changement de `spotId` d'une visite écrit un `YardMove` dans la MÊME
    transaction. N° via `SequencesService` (YV-/DA-, règle 8). Spots et sites sont des `Location` du tenant.
    Tout endpoint Yard est `@RequireModule(MODULE_KEYS.YARD)` + `yard.read|manage`, tenant-scopé (règle 1) ;
    FK (trailer/carrier/location/spot/appointment) vérifiées (règle 9).
```

- [ ] **Step 4: docs/etat-du-projet.md** — add a Yard Management row to the status table; bump "5 modules métier actifs (…)" → "6 … (…, yard)" and "27 migrations" → "28 migrations".

- [ ] **Step 5: Full build + typecheck + tests**
```bash
pnpm build        # all green
pnpm typecheck    # 0 errors
pnpm --filter @pulsar/shared test   # includes yard.workflow
```

- [ ] **Step 6: Commit**
```bash
git add CLAUDE.md docs/etat-du-projet.md
git commit -m "docs(yard): rule 34 (occupancy + move log + transitions) + status; Yard Management v1 shipped"
```

---

## Self-Review (completed by plan author)

**Spec coverage:** §A activation → Task 2/3. §B entities → Task 3. §C shared → Task 1. §D services: spots+appointments → Task 4, visits → Task 5, overview/board → Task 6. §E web → Task 8. §F rule 34 → Task 9. Tests → Tasks 1,4,5,7 + browser Task 9. All covered.

**Type consistency:** enums defined Task 1 (shared) mirrored Task 3 (prisma) with identical value names. `canTransitionYardVisit`/`canTransitionDockAppointment`/`isSpotOccupied` defined Task 1, consumed in Tasks 4/5/6. `YardMove` written in `assignToSpot`/`checkOut` (Task 5) per the same-transaction rule. `nextNumber` keys `'yard-visit'`→YV-, `'dock-appointment'`→DA- added in Task 4 (sequences) and used in Tasks 4/5. Endpoints consistent across controllers (4/5/6), e2e (7), web (8).

**Flagged verification points (not placeholders):** exact `SequencesService.nextNumber(tenantId, key)` signature + SequenceKey map (known from WMS — add the 2 new keys); `AuditLogsService.log(entry)` object shape (known); how a Location/Trailer is created in e2e (Task 7 names the file). `@IsDate()` on appointment date DTOs is mandatory (WMS whitelist lesson). The appointment-ARRIVED flip inside check-in uses a direct guarded `updateMany` to avoid a cross-service dependency.

**No-collision check:** brand-new module, brand-new tables, brand-new routes/nav group, one nullable set of FKs into existing `Location`/`Trailer`/`Carrier` (read-only references). No TMS/dispatch/agents/integrations code touched — safe alongside the parallel agent.
