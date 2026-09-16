# Module Accès + Lieux dans le cœur — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à un admin de tenant une vraie gestion des accès (rôles + gabarits, invitations robustes, protection du dernier admin) et sortir les Lieux du module TMS pour que WMS/Yard/Fabrication puissent créer leurs sites sans dépendre du TMS.

**Architecture:** (1) Un `PermissionsSyncService` au démarrage rend l'ajout de clés de permission sûr pour tous les tenants. (2) `LocationsService` migre dans `core/locations` avec une route `/locations` gardée par `core.locations.*` ; l'ancienne route `transportation/locations` reste un alias. (3) Le module Accès = gabarits de rôles purs dans `@pulsar/shared`, endpoints `roles/templates` + `roles/from-template`, endpoints `users/:id/resend-invitation` + `reactivate`, garde-fous « dernier admin » dans `UsersService`, et deux pages web (`/settings/roles`, `/settings/users` enrichie) + un `LocationFormModal` partagé branché dans les états vides WMS/Yard.

**Tech Stack:** NestJS 10 + Prisma (`@pulsar/database`), SvelteKit SPA Svelte 5 runes, `@pulsar/shared` (pure data, Vitest), Jest (unit + e2e supertest), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-16-access-module-core-locations-design.md`

## Global Constraints

- Tenant isolation : toute requête filtre `tenantId` issu de `@CurrentUser()` (règle 1).
- Nouveaux endpoints : `@RequirePermissions(...)` obligatoire ; pas de `@RequireModule` sur les routes cœur (règle 5).
- Mutations sensibles auditées : `@Audit(entityType, action)` pour les CRUD simples, `AuditLogsService.log` explicite pour les changements de statut (règles 6/14).
- Toute nouvelle clé de permission va dans `packages/shared/src/permissions.ts` (constante + descriptor dans `PERMISSION_CATALOG`).
- Après modification de `packages/shared` : `pnpm --filter @pulsar/shared build` avant de lancer l'API ou ses tests (règle 7).
- Projections utilisateur : jamais `passwordHash`, jamais de `tokenHash`.
- Pas de nouvelle migration Prisma dans ce plan (aucun changement de schéma).
- Textes UI en français, style Pulsar existant (`$lib/components/ui`), aucun nouveau thème.
- Commits par tâche, messages `feat(scope): …` / `test(scope): …`, se terminant par
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Prettier uniquement (`pnpm format` sur les fichiers touchés si besoin) ; pas d'ESLint.
- E2E API : nécessite `pnpm db:up && pnpm db:migrate && pnpm db:seed` ; lancer une suite :
  `pnpm --filter @pulsar/api test:e2e -- test/<nom>.e2e-spec.ts`. Unit API :
  `pnpm --filter @pulsar/api test -- <pattern>`. Shared : `pnpm --filter @pulsar/shared test`.
  Web unit : `pnpm --filter @pulsar/web test` (Vitest). Playwright : `pnpm --filter @pulsar/web
  exec playwright test e2e/<fichier>.spec.ts` (web dev server sur 5173 + API 3000 requis).

---

## Carte des fichiers

| Fichier | Rôle |
| --- | --- |
| `packages/shared/src/permissions.ts` | + `CORE.LOCATIONS_READ/MANAGE` + descriptors |
| `packages/shared/src/role-templates.ts` (créer) | `ROLE_TEMPLATES`, `resolveRoleTemplates` (pure) |
| `packages/shared/src/role-templates.spec.ts` (créer) | Vitest |
| `packages/shared/src/index.ts` | export `./role-templates` |
| `apps/api/src/core/permissions/permissions-sync.service.ts` (créer) | sync catalogue → BD + admin système |
| `apps/api/src/core/permissions/permissions-sync.service.spec.ts` (créer) | unit |
| `apps/api/src/core/permissions/permissions.module.ts` | provider + export |
| `apps/api/src/core/locations/` (créer : `locations.module.ts`, `locations.controller.ts`, `locations.service.ts`, `dto/location.dto.ts`, `locations.geocode.spec.ts`) | Lieux cœur (déplacement) |
| `apps/api/src/modules/transportation/locations/locations.controller.ts` | alias TMS (importe le service cœur) ; service + dto supprimés |
| `apps/api/src/modules/transportation/transportation.module.ts` | importe `CoreLocationsModule`, retire `LocationsService` des providers |
| `apps/api/src/core/connect/imports.service.ts` | import depuis `core/locations` |
| `apps/api/src/app.module.ts` | + `CoreLocationsModule` |
| `apps/api/src/core/roles/roles.controller.ts`, `roles.service.ts`, `dto/role.dto.ts`, `roles.module.ts` | templates + from-template + garde suppression |
| `apps/api/src/core/users/users.controller.ts`, `users.service.ts`, `users.service.spec.ts` (créer), `users.module.ts` | invitation/reactivate/dernier admin/projection |
| `apps/api/test/access-module.e2e-spec.ts` (créer) | e2e bout en bout |
| `apps/web/src/lib/components/locations/LocationFormModal.svelte` (créer) | formulaire lieu partagé |
| `apps/web/src/routes/(app)/locations/+page.svelte` | utilise `/locations` + le modal |
| 8 autres pages web utilisant `/transportation/locations` | → `/locations` |
| `apps/web/src/routes/(app)/wms/+page.svelte` | état vide + bouton « Créer un entrepôt » |
| pages Yard (`yard/spots`, `yard/gate`, `yard/appointments`) | bouton « + Site » via le modal |
| `apps/web/src/routes/(app)/settings/roles/+page.svelte` (créer) | page Rôles |
| `apps/web/src/routes/(app)/settings/users/+page.svelte` | enrichissements |
| `apps/web/src/lib/modules/navigation.ts` + `navigation.test.ts` | liens Rôles / Lieux |
| `apps/web/e2e/access-roles.spec.ts` (créer) | Playwright (API mockée) |
| `CLAUDE.md`, `docs/etat-du-projet.md`, `TODO.md`, `docs/plans/access-module-core-locations.md` (créer) | docs |

---

### Task 1: Permissions `core.locations.*` + synchronisation au démarrage

**Files:**
- Modify: `packages/shared/src/permissions.ts` (bloc `CORE`, ~ligne 9-41 ; `PERMISSION_CATALOG` après la ligne `core(PERMISSIONS.CORE.ROLES_MANAGE, …)`)
- Create: `apps/api/src/core/permissions/permissions-sync.service.ts`
- Create: `apps/api/src/core/permissions/permissions-sync.service.spec.ts`
- Modify: `apps/api/src/core/permissions/permissions.module.ts`

**Interfaces:**
- Produces: `PERMISSIONS.CORE.LOCATIONS_READ = 'core.locations.read'`, `PERMISSIONS.CORE.LOCATIONS_MANAGE = 'core.locations.manage'`.
- Produces: `PermissionsSyncService.sync(): Promise<{ permissionsUpserted: number; grantsAdded: number }>` — appelé par `onApplicationBootstrap()`, ne throw jamais.

- [ ] **Step 1: Ajouter les clés et descriptors**

Dans `PERMISSIONS.CORE`, après `ROLES_MANAGE` :
```ts
    LOCATIONS_READ: 'core.locations.read',
    LOCATIONS_MANAGE: 'core.locations.manage',
```
Dans `PERMISSION_CATALOG`, après la ligne `core(PERMISSIONS.CORE.ROLES_MANAGE, …)` :
```ts
  core(PERMISSIONS.CORE.LOCATIONS_READ, 'View locations (sites, warehouses, plants)'),
  core(PERMISSIONS.CORE.LOCATIONS_MANAGE, 'Create and update locations'),
```
Puis `pnpm --filter @pulsar/shared build && pnpm --filter @pulsar/shared test` → vert (le test existant du catalogue, s'il vérifie l'unicité, doit passer).

- [ ] **Step 2: Écrire le test unitaire du sync (échoue)**

`apps/api/src/core/permissions/permissions-sync.service.spec.ts` :
```ts
import { PermissionsSyncService } from './permissions-sync.service';

function prismaMock() {
  return {
    permission: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([{ id: 'p1', key: 'core.users.read' }, { id: 'p2', key: 'core.locations.read' }]),
    },
    role: { findMany: jest.fn().mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]) },
    rolePermission: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
}

describe('PermissionsSyncService', () => {
  it('upserts every catalog permission and grants them to system admin roles', async () => {
    const prisma = prismaMock();
    const svc = new PermissionsSyncService(prisma as never);
    const res = await svc.sync();
    expect(prisma.permission.upsert).toHaveBeenCalled();
    expect(prisma.role.findMany).toHaveBeenCalledWith({ where: { isSystem: true, key: 'admin' }, select: { id: true } });
    expect(prisma.rolePermission.createMany).toHaveBeenCalledTimes(2);
    expect(prisma.rolePermission.createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true });
    expect(res.grantsAdded).toBe(4);
  });

  it('never throws (best-effort) when the database fails', async () => {
    const prisma = prismaMock();
    prisma.permission.upsert.mockRejectedValue(new Error('db down'));
    const svc = new PermissionsSyncService(prisma as never);
    await expect(svc.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
```
Run: `pnpm --filter @pulsar/api test -- permissions-sync` → FAIL (module introuvable).

- [ ] **Step 3: Implémenter le service**

`permissions-sync.service.ts` :
```ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PERMISSION_CATALOG } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Keeps the Permission table aligned with the shared catalog and grants every
 * catalog permission to each tenant's system `admin` role. Idempotent,
 * best-effort: a failure is logged, never fatal (the seed remains the
 * authoritative path for a fresh database).
 */
@Injectable()
export class PermissionsSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionsSyncService.name);
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      const res = await this.sync();
      this.logger.log(`Permissions synced (${res.permissionsUpserted} keys, ${res.grantsAdded} admin grants added)`);
    } catch (err) {
      this.logger.error(`Permission sync failed: ${(err as Error).message}`);
    }
  }

  async sync() {
    for (const p of PERMISSION_CATALOG) {
      await this.prisma.permission.upsert({
        where: { key: p.key },
        update: { module: p.module, description: p.description },
        create: { key: p.key, module: p.module, description: p.description },
      });
    }
    const permissions = await this.prisma.permission.findMany({ select: { id: true } });
    const adminRoles = await this.prisma.role.findMany({ where: { isSystem: true, key: 'admin' }, select: { id: true } });
    let grantsAdded = 0;
    for (const role of adminRoles) {
      const res = await this.prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      });
      grantsAdded += res.count;
    }
    return { permissionsUpserted: PERMISSION_CATALOG.length, grantsAdded };
  }
}
```
Vérifier les noms de colonnes `Permission` (`key`, `module`, `description`) dans `schema.prisma` et adapter l'`update`/`create` si les champs diffèrent (garder le test aligné).

Dans `permissions.module.ts` : `providers: [PermissionsSyncService], exports: [PermissionsSyncService]`.

- [ ] **Step 4: Vérifier**

Run: `pnpm --filter @pulsar/api test -- permissions-sync` → PASS. `pnpm --filter @pulsar/api typecheck` → 0 erreur. Démarrer l'API (`pnpm --filter @pulsar/api dev` quelques secondes) et vérifier le log « Permissions synced ».

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/permissions.ts apps/api/src/core/permissions
git commit -m "feat(core): add core.locations permissions and boot-time permission sync"
```

---

### Task 2: Lieux dans le cœur (API)

**Files:**
- Create: `apps/api/src/core/locations/locations.module.ts`, `locations.controller.ts`, `locations.service.ts`, `dto/location.dto.ts`, `locations.geocode.spec.ts` (déplacés via `git mv` depuis `apps/api/src/modules/transportation/locations/`)
- Modify: `apps/api/src/modules/transportation/locations/locations.controller.ts` (devient l'alias)
- Modify: `apps/api/src/modules/transportation/transportation.module.ts`
- Modify: `apps/api/src/core/connect/imports.service.ts:23`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces: `CoreLocationsModule` (exporte `LocationsService`), routes `GET/POST /locations`, `GET/PATCH /locations/:id` (perms `core.locations.read|manage`, `@Audit('location', CREATE|UPDATE)`), alias inchangé `transportation/locations`.
- Produces: `GET /locations?type=WAREHOUSE` — filtre optionnel `type` (`LocationsListQueryDto extends ListQueryDto { @IsOptional() @IsEnum(LocationType) type?: LocationType }` dans `dto/location.dto.ts`) ; `LocationsService.list(tenantId, query)` ajoute `...(query.type ? { type: query.type } : {})` au `where`. L'alias TMS accepte le même DTO.

- [ ] **Step 1: Déplacer service, DTO et spec**

```bash
git mv apps/api/src/modules/transportation/locations/locations.service.ts apps/api/src/core/locations/locations.service.ts
git mv apps/api/src/modules/transportation/locations/dto apps/api/src/core/locations/dto
git mv apps/api/src/modules/transportation/locations/locations.geocode.spec.ts apps/api/src/core/locations/locations.geocode.spec.ts
```
Corriger les imports relatifs dans `locations.service.ts` (`../../common/...`, `../../prisma/...`, `../routing/routing.service`) et dans la spec.

- [ ] **Step 2: Créer le contrôleur cœur et le module**

`apps/api/src/core/locations/locations.controller.ts` : copie du contrôleur TMS avec
`@ApiTags('core/locations')`, **sans** `@RequireModule`, `@Controller('locations')`, permissions
`PERMISSIONS.CORE.LOCATIONS_READ` (GET) / `PERMISSIONS.CORE.LOCATIONS_MANAGE` (POST/PATCH), classe
`CoreLocationsController`. Garder `@Audit('location', AuditAction.CREATE|UPDATE)`.

`locations.module.ts` :
```ts
import { Module } from '@nestjs/common';
import { RoutingModule } from '../routing/routing.module';
import { CoreLocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

@Module({
  imports: [RoutingModule],
  controllers: [CoreLocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class CoreLocationsModule {}
```
(Vérifier comment `RoutingService` est fourni ailleurs — si `RoutingModule` est `@Global()`, l'import est inutile mais inoffensif ; `OwnershipService`/`PrismaService` viennent du `PrismaModule` global.)

- [ ] **Step 3: Alias TMS**

`apps/api/src/modules/transportation/locations/locations.controller.ts` : garder la classe `LocationsController` telle quelle mais importer `LocationsService` et les DTO depuis `../../../core/locations/...`. Ajouter un commentaire :
`/** Backward-compatible alias of core `/locations`, gated by the TMS module. New code uses `/locations`. */`

`transportation.module.ts` : `imports: [..., CoreLocationsModule]`, retirer `LocationsService` de `providers` ET de `exports` (les consommateurs importent `CoreLocationsModule`). `imports.service.ts:23` → `import { LocationsService } from '../locations/locations.service';` et s'assurer que `ConnectModule` importe `CoreLocationsModule`. `app.module.ts` : ajouter `CoreLocationsModule` après `RolesModule`.

- [ ] **Step 4: Vérifier**

`pnpm --filter @pulsar/api typecheck` → 0. `pnpm --filter @pulsar/api test -- locations` → PASS.
E2E de régression (BD seedée) : `pnpm --filter @pulsar/api test:e2e -- test/phase3.e2e-spec.ts test/configurable-wms-yard-fleet.e2e-spec.ts` → verts (ils utilisent `/transportation/locations`).
Smoke manuel : `curl -H "Authorization: Bearer <token admin>" localhost:3000/api/v1/locations` → 200 (l'admin a `core.locations.read` grâce au sync de la Task 1).

- [ ] **Step 5: Commit**

```bash
git add -A apps/api/src/core/locations apps/api/src/modules/transportation apps/api/src/core/connect/imports.service.ts apps/api/src/app.module.ts
git commit -m "feat(core): move locations to core with /locations route; keep TMS alias"
```

---

### Task 3: Gabarits de rôles (`@pulsar/shared`)

**Files:**
- Create: `packages/shared/src/role-templates.ts`, `packages/shared/src/role-templates.spec.ts`
- Modify: `packages/shared/src/index.ts` (ajouter `export * from './role-templates';` après `./permissions`)

**Interfaces:**
- Produces:
```ts
export interface RoleTemplate { key: string; name: string; description: string; module: ModuleKey | null; permissionKeys: PermissionKey[]; readOnlyOfEnabledModules?: true }
export interface ResolvedRoleTemplate { key: string; name: string; description: string; module: ModuleKey | null; permissionKeys: PermissionKey[] }
export const ROLE_TEMPLATES: RoleTemplate[];
export function resolveRoleTemplates(enabledModules: ModuleKey[]): ResolvedRoleTemplate[];
```

- [ ] **Step 1: Test Vitest (échoue)**

`role-templates.spec.ts` :
```ts
import { describe, expect, it } from 'vitest';
import { MODULE_KEYS } from './modules';
import { PERMISSION_CATALOG } from './permissions';
import { ROLE_TEMPLATES, resolveRoleTemplates } from './role-templates';

const catalogKeys = new Set(PERMISSION_CATALOG.map((p) => p.key));

describe('ROLE_TEMPLATES', () => {
  it('has unique kebab-case keys', () => {
    const keys = ROLE_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9-]+$/);
  });
  it('only references catalog permissions', () => {
    for (const t of ROLE_TEMPLATES) for (const k of t.permissionKeys) expect(catalogKeys.has(k), `${t.key}:${k}`).toBe(true);
  });
});

describe('resolveRoleTemplates', () => {
  it('drops templates whose module is not enabled and keeps core ones', () => {
    const res = resolveRoleTemplates([MODULE_KEYS.WMS]);
    const keys = res.map((t) => t.key);
    expect(keys).toContain('viewer');
    expect(keys).toContain('warehouse-operator');
    expect(keys).not.toContain('dispatcher');
  });
  it('viewer resolves to every .read key of core + enabled modules only', () => {
    const viewer = resolveRoleTemplates([MODULE_KEYS.BILLING]).find((t) => t.key === 'viewer')!;
    expect(viewer.permissionKeys.length).toBeGreaterThan(0);
    for (const k of viewer.permissionKeys) {
      expect(k.endsWith('.read')).toBe(true);
      const d = PERMISSION_CATALOG.find((p) => p.key === k)!;
      expect([MODULE_KEYS.CORE, MODULE_KEYS.BILLING]).toContain(d.module);
    }
  });
});
```
Run: `pnpm --filter @pulsar/shared test -- role-templates` → FAIL.

- [ ] **Step 2: Implémenter**

`role-templates.ts` (pure data + une fonction pure, aucun import Node) — reprendre exactement la table §2.4 de la spec. Squelette :
```ts
import { MODULE_KEYS, type ModuleKey } from './modules';
import { PERMISSIONS, PERMISSION_CATALOG, type PermissionKey } from './permissions';

const P = PERMISSIONS;
export const ROLE_TEMPLATES: RoleTemplate[] = [
  { key: 'viewer', name: 'Lecture seule', description: 'Consulte tout ce qui est activé, ne modifie rien.', module: null, permissionKeys: [], readOnlyOfEnabledModules: true },
  { key: 'dispatcher', name: 'Répartiteur', description: 'Planifie et exécute le transport.', module: MODULE_KEYS.TRANSPORTATION,
    permissionKeys: [P.TRANSPORTATION.MASTER_DATA_READ, P.TRANSPORTATION.ORDERS_READ, P.TRANSPORTATION.ORDERS_MANAGE, P.TRANSPORTATION.PLANNING_READ, P.TRANSPORTATION.PLANNING_MANAGE, P.TRANSPORTATION.EXECUTION_MANAGE, P.TRANSPORTATION.TRACKING_READ, P.TRANSPORTATION.TRACKING_WRITE, P.TRANSPORTATION.RATES_READ, P.TRANSPORTATION.ACCESSORIALS_READ, P.TRANSPORTATION.FUEL_TABLES_READ, P.TRANSPORTATION.ANALYTICS_READ, P.CORE.LOCATIONS_READ, P.CORE.LOCATIONS_MANAGE, P.CORE.DOCUMENTS_READ, P.CORE.OPERATING_TASKS_READ, P.CORE.OPERATING_TASKS_MANAGE, P.CORE.AGENTS_CHAT] },
  // … billing-clerk, accountant, warehouse-operator, warehouse-manager, yard-operator, fleet-manager, sales-rep, buyer, production-planner (spec §2.4)
];

export function resolveRoleTemplates(enabledModules: ModuleKey[]): ResolvedRoleTemplate[] {
  const allowed = new Set<ModuleKey>([MODULE_KEYS.CORE, ...enabledModules]);
  const catalog = new Set(PERMISSION_CATALOG.map((p) => p.key));
  return ROLE_TEMPLATES.filter((t) => t.module === null || allowed.has(t.module)).map((t) => {
    const keys = t.readOnlyOfEnabledModules
      ? PERMISSION_CATALOG.filter((p) => allowed.has(p.module) && p.key.endsWith('.read')).map((p) => p.key)
      : t.permissionKeys.filter((k) => catalog.has(k));
    return { key: t.key, name: t.name, description: t.description, module: t.module, permissionKeys: [...new Set(keys)] };
  });
}
```
Chaque gabarit inclut aussi la clé `.read` du module quand il a la `.manage` (ex. `wms.read` + `wms.manage`) — les guards testent une clé exacte.

- [ ] **Step 3: Vérifier et builder**

`pnpm --filter @pulsar/shared test` → PASS ; `pnpm --filter @pulsar/shared build`.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/role-templates.ts packages/shared/src/role-templates.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): add human role templates resolved by enabled modules"
```

---

### Task 4: Rôles — templates, from-template, garde de suppression (API)

**Files:**
- Modify: `apps/api/src/core/roles/roles.controller.ts`, `roles.service.ts`, `dto/role.dto.ts`, `roles.module.ts`

**Interfaces:**
- Consumes: `resolveRoleTemplates` (Task 3) ; les modules activés du tenant via `TenantModulesCacheService` (`core/module-registry`) — lire sa signature (`getEnabledModules(tenantId)` ou équivalent) avant d'écrire.
- Produces: `GET /roles/templates` → `Array<ResolvedRoleTemplate & { exists: boolean }>` ; `POST /roles/from-template` body `{ templateKey: string }` → rôle créé (include `roleInclude`) ; `DELETE /roles/:id` → 400 `Role is assigned to N user(s)` si `_count.users > 0`.

- [ ] **Step 1: DTO**

Ajouter dans `role.dto.ts` :
```ts
export class CreateRoleFromTemplateDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  templateKey!: string;
}
```

- [ ] **Step 2: Service**

Dans `RolesService` (injecter `TenantModulesCacheService` ; `RolesModule` importe `ModuleRegistryModule`) :
```ts
async templates(tenantId: string) {
  const enabled = await this.tenantModules.getEnabledModules(tenantId); // adapter au nom réel
  const existing = new Set((await this.prisma.role.findMany({ where: { tenantId }, select: { key: true } })).map((r) => r.key));
  return resolveRoleTemplates(enabled).map((t) => ({ ...t, exists: existing.has(t.key) }));
}

async createFromTemplate(tenantId: string, templateKey: string) {
  const enabled = await this.tenantModules.getEnabledModules(tenantId);
  const template = resolveRoleTemplates(enabled).find((t) => t.key === templateKey);
  if (!template) throw new BadRequestException(`Unknown or unavailable role template "${templateKey}"`);
  return this.create(tenantId, { key: template.key, name: template.name, description: template.description, permissionKeys: template.permissionKeys });
}
```
`remove` : après le check `isSystem`, `if (role._count.users > 0) throw new BadRequestException(\`Role is assigned to ${role._count.users} user(s)\`);`.

- [ ] **Step 3: Contrôleur**

Déclarer `@Get('templates')` AVANT `@Get(':id')` (sinon `:id` capture « templates »). `@Post('from-template')` avec `@Audit('role', AuditAction.CREATE)` et `@RequirePermissions(PERMISSIONS.CORE.ROLES_MANAGE)`. Ajouter `@Audit('role', CREATE/UPDATE/DELETE)` sur `POST`, `PATCH`, `DELETE` existants s'ils n'en ont pas.

- [ ] **Step 4: Vérifier**

`pnpm --filter @pulsar/api typecheck` → 0. Smoke : `GET /api/v1/roles/templates` avec le token admin acme → liste avec `exists=false` (sauf éventuels rôles déjà créés) ; `POST /roles/from-template {"templateKey":"viewer"}` → 201 puis 409.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/roles
git commit -m "feat(core): role templates endpoint, create-from-template and delete guard"
```

---

### Task 5: Utilisateurs — invitation, réactivation, dernier admin, projection (API)

**Files:**
- Modify: `apps/api/src/core/users/users.service.ts`, `users.controller.ts`, `users.module.ts`
- Create: `apps/api/src/core/users/users.service.spec.ts`

**Interfaces:**
- Produces: `POST /users/:id/resend-invitation` → `{ inviteUrl }` ; `POST /users/:id/reactivate` → user (+ `inviteUrl` si ré-invité) ; projection `invitation: { expiresAt: Date; expired: boolean } | null` ; `deactivate(tenantId, id, actorId)` et `update(tenantId, id, dto, actorId)` appliquent les garde-fous.
- Consumes: `AuditLogsService.log({ tenantId, userId: actorId, action: AuditAction.STATUS_CHANGE, entityType: 'user', entityId, before, after })`.

- [ ] **Step 1: Tests unitaires (échouent)**

`users.service.spec.ts` — construire `UsersService` avec des mocks Prisma (`user.findFirst`, `user.count`, `user.update`, `user.updateMany`, `userActionToken.updateMany/create`, `$transaction` qui exécute la callback avec le même mock), `ownership`, `config.get → 'http://web'`, `mail.queue → resolved`, `audit.log → resolved`. Cas :
1. `deactivate` refuse (400) quand `id === actorId` ;
2. `deactivate` refuse (400) quand la cible est ACTIVE, porte le rôle système `admin` et `count(ACTIVE users with system admin role in tenant) === 1` ;
3. `deactivate` passe quand il reste un autre admin actif (vérifie `updateMany({ where: { id, tenantId, status: { not: 'DISABLED' } }, data: { status: 'DISABLED' } })` et `audit.log` appelé) ;
4. `update` refuse (400) de retirer le rôle admin (roleIds sans l'id du rôle admin) au dernier admin actif ;
5. `resendInvitation` refuse (400) si `status !== 'INVITED'` ; sinon invalide les jetons (`userActionToken.updateMany({ where: { userId, kind: 'INVITATION', usedAt: null }, data: { usedAt: expect.any(Date) } })`), crée un jeton dont `expiresAt ≈ now + 72h`, appelle `mail.queue` et renvoie `inviteUrl` contenant `/reset-password/` ;
6. `reactivate` : DISABLED avec `lastLoginAt` → ACTIVE ; DISABLED sans `lastLoginAt` → INVITED + `inviteUrl` ; statut ≠ DISABLED → 400.

Run: `pnpm --filter @pulsar/api test -- users.service` → FAIL.

- [ ] **Step 2: Implémenter**

Points clés dans `UsersService` :
- `userSelect` : ajouter `actionTokens: { where: { kind: 'INVITATION', usedAt: null }, orderBy: { createdAt: 'desc' }, take: 1, select: { expiresAt: true } }` (vérifier le nom de la relation dans `model User`) et mapper en `invitation` via une fonction `project(user)` appliquée à toutes les sorties (retirer `actionTokens` du résultat).
- Factoriser `issueInvitation(tenantId, user: { id; email }): Promise<string>` (invalidation + jeton + courriel + `inviteUrl`) et l'utiliser dans `create`, `resendInvitation`, `reactivate`.
- `private async isLastActiveAdmin(tenantId, userId)` : cible a le rôle `{ isSystem: true, key: 'admin' }` ET `prisma.user.count({ where: { tenantId, status: 'ACTIVE', roles: { some: { role: { isSystem: true, key: 'admin' } } } } }) <= 1`.
- `deactivate(tenantId, id, actorId)` : `if (id === actorId) throw new BadRequestException('You cannot deactivate your own account')` ; `if (await this.isLastActiveAdmin(...)) throw new BadRequestException('Cannot deactivate the last active administrator')` ; `updateMany` conditionnel ; `audit.log` STATUS_CHANGE `{ before: { status }, after: { status: 'DISABLED' } }` ; renvoyer `get()`.
- `update(tenantId, id, dto, actorId)` : si `dto.roleIds` fourni, ne contient pas l'id du rôle admin système du tenant, et `isLastActiveAdmin` → 400 `Cannot remove the administrator role from the last active administrator`.
- Contrôleur : passer `user.id` comme `actorId` ; nouvelles routes :
```ts
@Post(':id/resend-invitation') @HttpCode(200) @RequirePermissions(PERMISSIONS.CORE.USERS_MANAGE)
resendInvitation(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.users.resendInvitation(u.tenantId, id, u.id); }
@Post(':id/reactivate') @HttpCode(200) @RequirePermissions(PERMISSIONS.CORE.USERS_MANAGE)
reactivate(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.users.reactivate(u.tenantId, id, u.id); }
```
- `UsersModule` importe `AuditLogsModule` ; `@Audit('user', CREATE/UPDATE)` sur `POST` et `PATCH`.

- [ ] **Step 3: Vérifier**

`pnpm --filter @pulsar/api test -- users.service` → PASS ; typecheck → 0 ; e2e de régression `test/phase6-platform.e2e-spec.ts` et `test/phase3.e2e-spec.ts` → verts.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/core/users
git commit -m "feat(core): resend invitation, reactivate, last-admin guards and invitation projection"
```

---

### Task 6: E2E `access-module`

**Files:**
- Create: `apps/api/test/access-module.e2e-spec.ts`

- [ ] **Step 1: Écrire la suite** (motif `module-settings.e2e-spec.ts` pour le bootstrap ; suffixe `Date.now().toString(36)` pour l'unicité)

Scénario, dans l'ordre :
1. `GET /roles/templates` → 200, contient `warehouse-operator` (le tenant acme a tous les modules activés).
2. `POST /roles/from-template { templateKey: 'warehouse-operator' }` → 201 **ou** 409 si déjà créé par un run précédent ; dans les deux cas récupérer le rôle via `GET /roles` (key `warehouse-operator`). Vérifier que ses `permissions` contiennent `wms.manage` et `core.locations.read`, pas `core.users.read`.
3. `POST /users { email: \`wh-${suffix}@acme.test\`, firstName, lastName, roleIds: [roleId] }` → 201, `status === 'INVITED'`, `inviteUrl` défini, `invitation.expired === false`.
4. `POST /users/:id/resend-invitation` → 200 avec un nouvel `inviteUrl` ≠ précédent ; l'ancien jeton ne fonctionne plus (`POST /auth/reset-password` avec l'ancien token → 400/401).
5. `POST /auth/reset-password { token: <du nouvel inviteUrl>, password: 'Passw0rd!123' }` → 200 ; `POST /auth/login { email, password, tenant: 'acme' }` → 200, token `whToken`.
6. Avec `whToken` : `POST /locations { code: \`WH-${suffix}\`, name, type: 'WAREHOUSE', addressLine1: '1 rue Test', city: 'Montréal', country: 'CA', latitude: 45.5, longitude: -73.6 }` → 201 ; `GET /wms/sites` → 200 et contient le lieu ; `GET /users` → 403 ; `POST /transportation/locations` → 403 (perm TMS absente).
7. Admin : `POST /users/:id/resend-invitation` sur le compte maintenant ACTIVE → 400.
8. Admin : `DELETE /roles/:roleId` → 400 (assigné).
9. Admin : `DELETE /users/:adminId` (soi-même) → 400 ; le compte admin étant le seul admin actif seedé, `DELETE` par un second admin n'est pas testé ici — tester plutôt : créer un second admin via `POST /users` avec `roleIds: [adminRoleId]` et `password`, puis avec le token de ce second admin `DELETE /users/:firstAdminId` → 200 **uniquement si** un autre admin actif existe (c'est le cas : le second) ; puis remettre : `POST /users/:firstAdminId/reactivate` → 200 `status ACTIVE`. Enfin, tenter de désactiver le dernier admin restant en désactivant d'abord le second (par le premier), puis le premier par… impossible (soi-même → 400) : vérifier au moins le 400 « self ». Garder l'admin seedé ACTIVE à la fin (les autres suites en dépendent) — utiliser `afterAll` pour `reactivate` en filet de sécurité.
10. Admin : `DELETE /users/:whUserId` → 200 `status DISABLED` ; `POST /users/:whUserId/reactivate` → 200 `status ACTIVE` (il a un `lastLoginAt`).

- [ ] **Step 2: Lancer**

`pnpm --filter @pulsar/api test:e2e -- test/access-module.e2e-spec.ts` → PASS. Relancer une seconde fois → PASS (idempotence : 409 géré, suffixes uniques).

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/access-module.e2e-spec.ts
git commit -m "test(core): e2e for role templates, invitations, last-admin guards and core locations"
```

---

### Task 7: `LocationFormModal` partagé + page `/locations` sur `/locations`

**Files:**
- Create: `apps/web/src/lib/components/locations/LocationFormModal.svelte`
- Modify: `apps/web/src/routes/(app)/locations/+page.svelte`

**Interfaces:**
- Produces (props Svelte 5) :
```ts
let { open = $bindable(false), location = null as LocationRecord | null, lockedType = null as string | null, defaultType = 'WAREHOUSE', oncreated = (loc: LocationRecord) => {}, onupdated = (loc: LocationRecord) => {} } = $props();
```
`LocationRecord` = forme renvoyée par `GET /locations/:id` (id, code, name, type, addressLine1/2, city, state, postalCode, country, latitude, longitude, timezone, isActive, customerId). Le modal fait lui-même `POST /locations` / `PATCH /locations/:id`, gère `saving`/`error` localement, et appelle le callback avec la réponse.

- [ ] **Step 1: Extraire le formulaire** de `locations/+page.svelte` (lignes du `<Modal>` + `form`/`save`) vers le composant. Quand `lockedType` est défini, le `<Select>` de type est `disabled` et la valeur forcée. Utiliser `Field`, `Input`, `Select`, `Button`, `Modal` de `$lib/components/ui`.

- [ ] **Step 2: Rebrancher la page** : liste via `api('/locations')`, création/édition via le modal, rafraîchissement dans `oncreated`/`onupdated`. Le lien de la page reste `/locations`.

- [ ] **Step 3: Vérifier** : `pnpm --filter @pulsar/web typecheck` (svelte-check) → 0 nouvelle erreur ; rendre la page dans le navigateur (admin acme) : créer un lieu de type PLANT, l'éditer, vérifier l'appel réseau `POST /api/v1/locations`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/locations apps/web/src/routes/\(app\)/locations
git commit -m "feat(web): shared LocationFormModal and /locations on core route"
```

---

### Task 8: Migrer les 8 autres usages web vers `/locations` + raccourcis WMS/Yard

**Files:**
- Modify: `apps/web/src/lib/components/LoadMap.svelte:25`, `routes/(app)/crm/sales-orders/[id]/+page.svelte:304`, `lanes/+page.svelte:143`, `rate-studio/+page.svelte:172`, `transport-orders/+page.svelte:166`, `yard/appointments/+page.svelte:144`, `yard/gate/+page.svelte:176`, `yard/spots/+page.svelte:78` (numéros indicatifs, relus sur `main`)
- Modify: `apps/web/src/routes/(app)/wms/+page.svelte` (état vide ~ligne 166 + barre du sélecteur ~ligne 145)
- Modify: `apps/web/src/routes/(app)/yard/spots/+page.svelte` (sélecteur de site)

**Interfaces:**
- Consumes: `LocationFormModal` (Task 7) ; permission via `$auth?.user.permissions.includes(PERMISSIONS.CORE.LOCATIONS_MANAGE)`.

- [ ] **Step 1: Remplacer** `'/transportation/locations'` par `'/locations'` dans les 8 fichiers (`grep -rn "/transportation/locations" apps/web/src` doit ne plus rien renvoyer).

- [ ] **Step 2: WMS** : dans l'état vide « Choisissez un entrepôt », remplacer le message par « Aucun entrepôt n'existe encore pour ce tenant. » + bouton primaire **« Créer un entrepôt »** (visible si `canManageLocations`) ouvrant `LocationFormModal` avec `lockedType="WAREHOUSE"` ; `oncreated` → recharge `/wms/sites`, `siteId = loc.id`, `load()`. Sans permission : texte « Demandez à un administrateur de créer un lieu de type entrepôt. » + lien `/locations` si `core.locations.read`. Ajouter à côté de l'`EntityPicker` un bouton secondaire « + Entrepôt » (même modal) visible si `canManageLocations`.

- [ ] **Step 3: Yard** : sur `yard/spots` (et `yard/gate`/`yard/appointments` si un sélecteur de site y existe avec état vide), ajouter le même bouton « + Site » (`lockedType` = null, `defaultType='OTHER'` ou le type que le Yard filtre — lire le filtre `type` appliqué par ces pages et le respecter). Sur l'accueil Yard (`yard/+page.svelte`, état vide « aucun site » ~ligne 720 sur `main`), ajouter le bouton « Créer un site » (même modal) conditionné à `core.locations.manage`.

- [ ] **Step 3b: Fabrication** : `manufacturing/materials/+page.svelte:57` appelle `/wms/sites` (gardé WMS) → remplacer par `api('/locations', { query: { type: 'WAREHOUSE', pageSize: 100 } })` (les sites Fabrication sont des lieux WAREHOUSE actifs, cf. `calendars.service.ts:72`). Vérifier les autres pages Fabrication qui listent des sites (`grep -rn "wms/sites" apps/web/src/routes/\(app\)/manufacturing`) et appliquer la même substitution. Ajouter le bouton « + Site (entrepôt) » via `LocationFormModal` `lockedType="WAREHOUSE"` là où un sélecteur de site a un état vide.

- [ ] **Step 4: Vérifier** : svelte-check → 0 nouvelle erreur ; navigateur : WMS avec l'admin acme (des entrepôts existent → le bouton « + Entrepôt » est là) ; simuler l'absence de permission via `localStorage` (`s.user.permissions = ['wms.manage']`) → pas de bouton, texte alternatif.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): use core /locations everywhere; create-warehouse shortcuts in WMS and Yard"
```

---

### Task 9: Page `/settings/roles` + navigation

**Files:**
- Create: `apps/web/src/routes/(app)/settings/roles/+page.svelte`
- Modify: `apps/web/src/lib/modules/navigation.ts` (section Réglages → Plateforme), `navigation.test.ts`

**Interfaces:**
- Consumes: `GET /roles` (items avec `permissions[].permission.key`, `_count.users`, `isSystem`), `GET /permissions` (catalogue BD : `key`, `module`, `description`), `GET /roles/templates`, `POST /roles`, `POST /roles/from-template`, `PATCH /roles/:id`, `DELETE /roles/:id` ; `MODULE_CATALOG` (labels), `slugify` (`@pulsar/shared`).

- [ ] **Step 1: Test nav (échoue)** — dans `navigation.test.ts`, ajouter : avec `can = (p) => p === 'core.roles.read'`, `visibleDomains` contient dans `settings` un lien `{ href: '/settings/roles' }` ; sans la perm, il est absent ; `'/settings/locations'` n'existe pas mais un lien `href: '/locations'` apparaît sous Réglages avec `core.locations.read`. Run `pnpm --filter @pulsar/web test -- navigation` → FAIL.

- [ ] **Step 2: Nav** — dans la section `Plateforme` de `settings`, après `Utilisateurs` :
```ts
{ href: '/settings/roles', label: 'Rôles', perm: PERMISSIONS.CORE.ROLES_READ },
{ href: '/locations', label: 'Lieux', perm: PERMISSIONS.CORE.LOCATIONS_READ },
```
Et dans le domaine Transport, section « Partenaires » (`navigation.ts:~156`), le lien existant `{ href: '/locations', label: 'Lieux' }` reçoit `perm: PERMISSIONS.CORE.LOCATIONS_READ` (l'audit a montré que ce lien s'affiche à tous puis 403). La page `/locations` masque « Nouveau lieu » et les actions d'édition sans `core.locations.manage` (Task 7 doit l'avoir fait ; sinon le faire ici). Test → PASS.

- [ ] **Step 3: Page** (motif `settings/users/+page.svelte`) :
- chargement parallèle `/roles`, `/permissions`, `/roles/templates` ;
- tableau : Nom · Clé · Description · Utilisateurs · badge « Système » · actions (Modifier, Supprimer — désactivée si `_count.users > 0` ou `isSystem`, avec `title` explicatif) ;
- bloc « Rôles suggérés » : cartes pour `templates.filter(t => !t.exists)` : nom, description, nombre de permissions, bouton « Créer ce rôle » → `POST /roles/from-template` puis recharge + toast ;
- `Modal` créer/éditer : `Input` nom (à la création, `key = slugify(name)` tant que l'utilisateur n'a pas touché la clé), `Input` clé (pattern kebab), `Textarea` description, puis **groupes par module** : pour chaque module du catalogue BD présent dans `['core', ...$auth.tenant.enabledModules]` (ordre `MODULE_CATALOG`), entête avec le label du module + boutons « Tout lire » / « Tout gérer » / « Aucun », puis une case par permission (libellé = `description`, sous-texte = `key`). Les clés déjà attribuées mais hors filtre s'affichent dans un groupe « Autres (module inactif) », cochées, non modifiables ;
- rôle système : cases `disabled`, note « Les permissions d'un rôle système ne sont pas modifiables » ;
- erreurs API dans `error` local, succès via `toast`.

- [ ] **Step 4: Vérifier** : svelte-check → 0 ; navigateur : créer « Répartiteur » depuis le gabarit, créer un rôle custom « Magasinier nuit » avec `wms.read` + `wms.manage`, l'éditer, tenter de supprimer un rôle assigné (bouton désactivé), supprimer le custom.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/\(app\)/settings/roles apps/web/src/lib/modules/navigation.ts apps/web/src/lib/modules/navigation.test.ts
git commit -m "feat(web): roles page with module-grouped permissions and suggested role templates"
```

---

### Task 10: Page `/settings/users` enrichie

**Files:**
- Modify: `apps/web/src/routes/(app)/settings/users/+page.svelte`

**Interfaces:**
- Consumes: projection `invitation`, `POST /users/:id/resend-invitation`, `POST /users/:id/reactivate`, `PATCH /users/:id`.

- [ ] **Step 1: Implémenter**
- type `UserRow` : + `invitation: { expiresAt: string; expired: boolean } | null` ;
- colonne Statut : `Actif` (ok) / `Invité · expire dans Xh` (warn) / `Invitation expirée` (danger) / `Désactivé` (muted) — calcul du délai côté client depuis `expiresAt` ;
- filtre `Select` statut (Tous / Actifs / Invités / Désactivés) appliqué côté client ;
- actions par ligne : « Modifier » (modal prénom/nom/rôles → `PATCH`), « Renvoyer l'invitation » (si INVITED → `POST …/resend-invitation`, affiche le nouveau lien dans le bandeau existant `inviteUrl`), « Désactiver » (confirmation existante), « Réactiver » (si DISABLED → `POST …/reactivate` ; si la réponse porte `inviteUrl`, l'afficher) ;
- texte d'aide sous le titre : « Les changements de rôle prennent effet à la prochaine reconnexion de l'utilisateur (au plus 15 minutes). » ;
- dans le modal d'invitation, si `roles.filter(r => r.key !== 'admin').length === 0` : encart « Aucun rôle limité n'existe encore — créez-en dans Rôles » avec lien `/settings/roles`.

- [ ] **Step 2: Vérifier** : svelte-check → 0 ; navigateur : inviter, renvoyer, modifier les rôles, désactiver (message 400 « dernier admin » affiché pour l'admin seedé si on essaie), réactiver.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/\(app\)/settings/users
git commit -m "feat(web): user edit, invitation expiry, resend and reactivate on users page"
```

---

### Task 11: Playwright `access-roles`

**Files:**
- Create: `apps/web/e2e/access-roles.spec.ts` (motif `fleet-workspace.spec.ts` : `login`, `page.route('**/api/v1/...')` pour mocker)

- [ ] **Step 1: Écrire** trois tests :
1. `/settings/roles` rend les groupes par module : mock `/roles` (1 rôle admin système + 1 custom), `/permissions` (4 clés core + 2 wms), `/roles/templates` (viewer non existant) ; `s.tenant.enabledModules = ['wms']` ; ouvrir « Nouveau rôle » → les entêtes « Plateforme » et « Entrepôt » (labels `MODULE_CATALOG`) sont visibles, pas « Transport ».
2. « Créer ce rôle » depuis un gabarit appelle `POST /roles/from-template` avec `{ templateKey: 'viewer' }` (assert sur `request.postDataJSON()`).
3. `/wms` sans entrepôt : mock `/wms/sites` → `{ items: [], total: 0 }` ; avec `permissions = ['wms.manage','core.locations.manage']` le bouton « Créer un entrepôt » est visible ; avec `['wms.manage']` seulement, il est absent et le texte « Demandez à un administrateur » est visible.

- [ ] **Step 2: Lancer** : `pnpm --filter @pulsar/web exec playwright test e2e/access-roles.spec.ts` → 3/3.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/access-roles.spec.ts
git commit -m "test(web): playwright coverage for roles page and warehouse creation shortcut"
```

---

### Task 12: Docs, règle 50, dette, vérification finale

**Files:**
- Modify: `CLAUDE.md` (ajouter la section « Hard rules (continued, module Accès & Lieux cœur) » règle 50 — texte §2.5 de la spec), `docs/etat-du-projet.md` (entrée datée 2026-09-16 en tête, même format que les précédentes), `TODO.md` — nouvelle section « Référentiel partagé (dette issue de l'audit 2026-09-16) » reprenant la table §4 de la spec ligne par ligne, notamment : (a) comptes nommés portail client/transporteur/chauffeur ; (b) `Customer`/`Carrier`/`Vehicle`/`Trailer`/`Driver`/`Lane` n'ont qu'un point d'écriture TMS → arc « core/master-data » avec alias TMS (même patron que les Lieux) ; (c) `/assets` (home Fleet) appelle `transportation/*` sans `.catch` (`assets/+page.svelte:84`) ; (d) Yard gate/appointments lisent carriers/trailers via TMS ; (e) Fabrication BOM ⇒ `WmsItem` créable seulement via WMS ; (f) pickers Billing `.catch → []` silencieux ; (g) Achats sans lien vers transporteurs/liaisons ; (h) admin des portails uniquement dans les pages TMS `customers`/`carriers` ; (i) domaine Transport sans `anyPerms`, liens Partenaires sans `perm` (Clients/Transporteurs).
- Create: `docs/plans/access-module-core-locations.md` (contrats, limites, reprise — 1 page)

- [ ] **Step 1: Rédiger** les quatre documents. L'entrée `etat-du-projet` cite les chiffres RÉELS des gates ci-dessous (pas d'estimation).

- [ ] **Step 2: Gates complets**
```bash
pnpm typecheck
pnpm test
pnpm --filter @pulsar/api test:e2e -- test/access-module.e2e-spec.ts test/phase3.e2e-spec.ts test/phase4.e2e-spec.ts test/phase5.e2e-spec.ts test/configurable-wms-yard-fleet.e2e-spec.ts test/collaboration.e2e-spec.ts test/phase6-platform.e2e-spec.ts test/wms-module.e2e-spec.ts
pnpm --filter @pulsar/web exec playwright test e2e/access-roles.spec.ts e2e/wms-workspace.spec.ts e2e/yard-workspace.spec.ts
git diff --check
```
Tout vert ; noter les comptes exacts.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs TODO.md
git commit -m "docs: access module, core locations rule 50, status and debt"
```

---

## Ordre d'exécution et parallélisme

- Task 1 → Task 2 (dépend des perms) ; Task 3 → Task 4 ; Task 5 indépendante de 2-4 ; Task 6 après 2, 4, 5.
- Task 7 après 2 ; Task 8 après 7 ; Task 9 après 4 ; Task 10 après 5 ; Task 11 après 8-9 ; Task 12 en dernier.
- Parallélisable : {Task 1} puis {Task 2, Task 3, Task 5} puis {Task 4, Task 7} puis {Task 6, Task 8, Task 9, Task 10} puis {Task 11} puis {Task 12}.
