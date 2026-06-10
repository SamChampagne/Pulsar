# Phase 6B — Plan d'administration plateforme : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer/suspendre/réactiver des tenants sans le seed, via un rôle « platform admin » totalement disjoint du modèle tenant (modèle `PlatformUser`, login dédié, guard dédié), sans affaiblir l'isolation existante.

**Architecture:** Nouveau modèle `PlatformUser` (aucune relation tenant). Deux stratégies Passport étanches : la stratégie `jwt` existante rejette les tokens plateforme, la nouvelle `platform-jwt` n'accepte qu'eux et relit le `status` en base à chaque requête. Les contrôleurs plateforme sont `@Public()` (pour contourner le `JwtAuthGuard` global) + `@UseGuards(PlatformGuard)`. Création de tenant = transaction qui rejoue la logique du seed (tenant + rôle admin complet + utilisateur INVITED + invitation 72 h + modules).

**Tech Stack:** NestJS 11, Passport/JWT, Prisma, SvelteKit (Svelte 5 runes), jest unitaire (config du plan 6A) + e2e.

**Référence spec:** spec phase 6 section 1. **Dépendance:** plan 6A (config jest unitaire). Note de déviation assumée : le spec dit `metadata.platformActor`, mais `AuditLog` n'a pas de colonne `metadata` — l'acteur plateforme est journalisé dans le JSON `after` (`after.platformActor`).

---

### Task 1: Enum + types partagés

**Files:**
- Modify: `packages/shared/src/enums/core.ts`
- Modify: `packages/shared/src/types/auth.ts`

- [ ] **Step 1: Ajouter l'enum (règle 3 : shared d'abord, Prisma le mire en Task 2)**

Dans `packages/shared/src/enums/core.ts`, ajouter :

```ts
/** Platform-plane operators (cross-tenant). Mirrored in schema.prisma. */
export enum PlatformUserStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}
```

- [ ] **Step 2: Ajouter les types d'auth plateforme**

Dans `packages/shared/src/types/auth.ts`, ajouter à la fin :

```ts
/** Payload of a platform-plane access token. Tenant guards MUST reject it. */
export interface PlatformJwtPayload {
  /** PlatformUser id */
  sub: string;
  email: string;
  platformAdmin: true;
}

export interface PlatformAuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface PlatformLoginResponse {
  accessToken: string;
  user: PlatformAuthUser;
}
```

- [ ] **Step 3: Rebuild shared (règle 7)**

Run: `pnpm --filter @pulsar/shared build && pnpm --filter @pulsar/shared test`
Expected: build OK, tests existants verts.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/enums/core.ts packages/shared/src/types/auth.ts
git commit -m "feat(shared): platform admin enum and auth types"
```

---

### Task 2: Modèle Prisma + migration + seed

**Files:**
- Modify: `packages/database/prisma/schema.prisma`
- Modify: `packages/database/prisma/seed.ts`

- [ ] **Step 1: Ajouter le modèle au schéma**

Dans `packages/database/prisma/schema.prisma`, dans la section CORE (après le modèle `RefreshToken`), ajouter :

```prisma
enum PlatformUserStatus {
  ACTIVE
  DISABLED
}

// Cross-tenant operators (create/suspend tenants). Deliberately has NO relation
// to any tenant-scoped model — the platform plane never mixes with tenant data.
model PlatformUser {
  id           String             @id @default(cuid())
  email        String             @unique
  passwordHash String
  firstName    String
  lastName     String
  status       PlatformUserStatus @default(ACTIVE)
  lastLoginAt  DateTime?
  createdAt    DateTime           @default(now())
  updatedAt    DateTime           @updatedAt

  @@map("platform_users")
}
```

- [ ] **Step 2: Migrer + régénérer**

Run: `pnpm db:migrate` (nom de migration : `platform_users`)
Expected: migration créée et appliquée, client régénéré.

Run: `pnpm --filter @pulsar/database build`
Expected: OK.

- [ ] **Step 3: Seeder l'admin plateforme**

Dans `packages/database/prisma/seed.ts`, après le bloc « Admin role + user » (après la ligne `console.log(\`Tenant "${tenant.slug}" ready...\`)`), ajouter :

```ts
  // --- Platform admin --------------------------------------------------------
  const platformEmail = process.env.PLATFORM_ADMIN_EMAIL ?? 'platform@pulsar.dev';
  const platformPassword = process.env.PLATFORM_ADMIN_PASSWORD ?? 'admin123';
  await prisma.platformUser.upsert({
    where: { email: platformEmail },
    update: {},
    create: {
      email: platformEmail,
      passwordHash: hashSync(platformPassword, 10),
      firstName: 'Platform',
      lastName: 'Admin',
      status: 'ACTIVE',
    },
  });
  console.log(`Platform admin ready — ${platformEmail}`);
```

- [ ] **Step 4: Reseed et vérifier**

Run: `pnpm db:seed`
Expected: log `Platform admin ready — platform@pulsar.dev`.

- [ ] **Step 5: Commit**

```bash
git add packages/database/prisma/
git commit -m "feat(db): PlatformUser model, migration and seed"
```

---

### Task 3: Garde-fou production du mot de passe plateforme (TDD)

**Files:**
- Create: `apps/api/src/common/boot-checks.ts`
- Test: `apps/api/src/common/boot-checks.spec.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `.env.example`

- [ ] **Step 1: Écrire le test qui échoue**

`apps/api/src/common/boot-checks.spec.ts` :

```ts
import { assertProductionSecrets } from './boot-checks';

describe('assertProductionSecrets', () => {
  it('does nothing outside production', () => {
    expect(() => assertProductionSecrets({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertProductionSecrets({})).not.toThrow();
  });

  it('refuses to boot in production with the default platform password', () => {
    expect(() =>
      assertProductionSecrets({ NODE_ENV: 'production', PLATFORM_ADMIN_PASSWORD: 'admin123' }),
    ).toThrow(/PLATFORM_ADMIN_PASSWORD/);
  });

  it('refuses to boot in production without a platform password', () => {
    expect(() => assertProductionSecrets({ NODE_ENV: 'production' })).toThrow(
      /PLATFORM_ADMIN_PASSWORD/,
    );
  });

  it('refuses production with the published example secrets (.env.example / CI)', () => {
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        PLATFORM_ADMIN_PASSWORD: 'S0lid-P@ss',
        ENCRYPTION_KEY: 'q8mB3dT9rV2xU5nC7sE4hG1jL0aF3kM8oP4wY6zI1tQ=',
      }),
    ).toThrow(/ENCRYPTION_KEY/);
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        PLATFORM_ADMIN_PASSWORD: 'S0lid-P@ss',
        JWT_SECRET: 'change-me-in-production',
      }),
    ).toThrow(/JWT_SECRET/);
  });

  it('boots in production with real secrets', () => {
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        PLATFORM_ADMIN_PASSWORD: 'S0lid-P@ss',
        JWT_SECRET: 'a-real-secret',
        ENCRYPTION_KEY: 'someRealBase64Key/Generated/ByOps0000000000=',
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm --filter @pulsar/api test`
Expected: FAIL — module `./boot-checks` introuvable.

- [ ] **Step 3: Implémenter et brancher au boot**

`apps/api/src/common/boot-checks.ts` :

```ts
/**
 * Fail-fast production checks, run before Nest even instantiates the app.
 * Same posture as the ENCRYPTION_KEY validation in CryptoService: a
 * misconfigured production deployment must not come up at all.
 *
 * Published example values (.env.example, CI workflow) are rejected too —
 * someone WILL copy them to production one day.
 */
const PUBLISHED_EXAMPLES: Record<string, string[]> = {
  JWT_SECRET: ['change-me-in-production', 'ci-only-secret'],
  ENCRYPTION_KEY: [
    'q8mB3dT9rV2xU5nC7sE4hG1jL0aF3kM8oP4wY6zI1tQ=', // .env.example
    '1qK0pZ8Yw3mB6dT9rV2xU5nC7sE4hG1jL0aF3kM8oP4=', // CI workflow
  ],
};

export function assertProductionSecrets(env: Record<string, string | undefined>): void {
  if (env.NODE_ENV !== 'production') return;
  const password = env.PLATFORM_ADMIN_PASSWORD;
  if (!password || password === 'admin123') {
    throw new Error(
      'PLATFORM_ADMIN_PASSWORD must be set to a non-default value in production ' +
        '(the seeded platform admin would otherwise be sign-in-able with admin123).',
    );
  }
  for (const [name, examples] of Object.entries(PUBLISHED_EXAMPLES)) {
    const value = env[name];
    if (value && examples.includes(value)) {
      throw new Error(
        `${name} is set to a published example value (.env.example / CI) — generate a real secret for production.`,
      );
    }
  }
}
```

Dans `apps/api/src/main.ts`, en tête de `bootstrap()` (avant `NestFactory.create`) :

```ts
import { assertProductionSecrets } from './common/boot-checks';
// première ligne de bootstrap():
assertProductionSecrets(process.env);
```

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `pnpm --filter @pulsar/api test`
Expected: PASS

- [ ] **Step 5: Documenter dans `.env.example`** (bloc `# --- Auth ---`)

```
# Platform plane (cross-tenant ops). In production the API refuses to start
# if this is unset or still the default.
PLATFORM_ADMIN_EMAIL=platform@pulsar.dev
PLATFORM_ADMIN_PASSWORD=admin123
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/common/boot-checks.ts apps/api/src/common/boot-checks.spec.ts apps/api/src/main.ts .env.example
git commit -m "feat(api): refuse production boot with default platform password"
```

---

### Task 4: Étanchéité de la stratégie tenant (TDD) + stratégie/garde plateforme

**Files:**
- Modify: `apps/api/src/core/auth/jwt.strategy.ts`
- Test: `apps/api/src/core/auth/jwt.strategy.spec.ts`
- Create: `apps/api/src/core/platform/platform-jwt.strategy.ts`
- Create: `apps/api/src/core/platform/platform.guard.ts`

- [ ] **Step 1: Test d'étanchéité de la stratégie tenant (échoue)**

`apps/api/src/core/auth/jwt.strategy.spec.ts` :

```ts
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

const strategy = new JwtStrategy({
  getOrThrow: () => 'test-secret',
} as unknown as ConfigService);

describe('JwtStrategy (tenant)', () => {
  it('accepts a regular tenant payload', () => {
    const user = strategy.validate({
      sub: 'u1',
      tenantId: 't1',
      email: 'a@b.c',
      permissions: [],
    });
    expect(user.tenantId).toBe('t1');
  });

  it('rejects platform tokens (platformAdmin claim)', () => {
    expect(() =>
      strategy.validate({
        sub: 'p1',
        email: 'platform@pulsar.dev',
        platformAdmin: true,
      } as never),
    ).toThrow(UnauthorizedException);
  });

  it('rejects payloads without tenantId', () => {
    expect(() =>
      strategy.validate({ sub: 'u1', email: 'a@b.c', permissions: [] } as never),
    ).toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm --filter @pulsar/api test`
Expected: FAIL — les payloads plateforme passent aujourd'hui.

- [ ] **Step 3: Durcir la stratégie tenant**

Dans `apps/api/src/core/auth/jwt.strategy.ts`, remplacer la méthode `validate` par :

```ts
  validate(payload: JwtPayload & { platformAdmin?: boolean }): AuthUser {
    // Watertight separation of the two planes: a platform-plane token must
    // never reach a tenant route (and tenant guards all assume tenantId).
    if (payload.platformAdmin || !payload.tenantId) {
      throw new UnauthorizedException('Not a tenant access token');
    }
    return {
      id: payload.sub,
      tenantId: payload.tenantId,
      email: payload.email,
      firstName: '',
      lastName: '',
      permissions: payload.permissions ?? [],
    };
  }
```

(ajouter `UnauthorizedException` à l'import `@nestjs/common`.)

- [ ] **Step 4: Lancer, vérifier le succès**

Run: `pnpm --filter @pulsar/api test`
Expected: PASS

- [ ] **Step 5: Stratégie plateforme + guard (relecture du status en base)**

`apps/api/src/core/platform/platform-jwt.strategy.ts` :

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { PlatformJwtPayload } from '@pulsar/shared';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class PlatformJwtStrategy extends PassportStrategy(Strategy, 'platform-jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: PlatformJwtPayload & { platformAdmin?: boolean }) {
    if (payload.platformAdmin !== true) {
      throw new UnauthorizedException('Not a platform access token');
    }
    return { id: payload.sub, email: payload.email };
  }
}
```

`apps/api/src/core/platform/platform.guard.ts` :

```ts
import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Platform-plane guard. On top of the platform-jwt strategy, the PlatformUser
 * status is re-read from the database on EVERY request: platform tokens live
 * 12 h without refresh, so a DISABLED operator must lose access immediately.
 * Platform routes are low-traffic; the per-request DB hit is negligible.
 */
@Injectable()
export class PlatformGuard extends AuthGuard('platform-jwt') {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;
    const request = context.switchToHttp().getRequest();
    const platformUser = await this.prisma.platformUser.findUnique({
      where: { id: request.user.id },
    });
    if (!platformUser || platformUser.status !== 'ACTIVE') {
      throw new UnauthorizedException('Platform account is disabled');
    }
    request.user = {
      id: platformUser.id,
      email: platformUser.email,
      firstName: platformUser.firstName,
      lastName: platformUser.lastName,
    };
    return true;
  }
}
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: exit 0

```bash
git add apps/api/src/core/auth/jwt.strategy.ts apps/api/src/core/auth/jwt.strategy.spec.ts apps/api/src/core/platform/
git commit -m "feat(api): watertight tenant/platform JWT strategies + PlatformGuard"
```

---

### Task 5: Auth plateforme (login 12 h)

**Files:**
- Create: `apps/api/src/core/platform/platform-auth.service.ts`
- Create: `apps/api/src/core/platform/platform-auth.controller.ts`
- Create: `apps/api/src/core/platform/platform.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Service**

`apps/api/src/core/platform/platform-auth.service.ts` :

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { PlatformJwtPayload, PlatformLoginResponse } from '@pulsar/shared';
import { compare } from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<PlatformLoginResponse> {
    const user = await this.prisma.platformUser.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user || user.status !== 'ACTIVE' || !(await compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.prisma.platformUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const payload: PlatformJwtPayload = { sub: user.id, email: user.email, platformAdmin: true };
    return {
      // Ops plane: 12 h access token, no refresh token (re-login is acceptable).
      accessToken: await this.jwt.signAsync(payload, { expiresIn: '12h' }),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }
}
```

- [ ] **Step 2: Controller + module + enregistrement**

`apps/api/src/core/platform/platform-auth.controller.ts` :

```ts
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { PlatformAuthService } from './platform-auth.service';

class PlatformLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

@ApiTags('platform')
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  // @Public bypasses the global tenant JwtAuthGuard; credentials do the gating.
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: PlatformLoginDto) {
    return this.auth.login(dto.email, dto.password);
  }
}
```

`apps/api/src/core/platform/platform.module.ts` :

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { EmailModule } from '../email/email.module';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformJwtStrategy } from './platform-jwt.strategy';
import { PlatformGuard } from './platform.guard';
import { PlatformTenantsController } from './platform-tenants.controller';
import { PlatformTenantsService } from './platform-tenants.service';

@Module({
  imports: [
    AuditLogsModule,
    EmailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [PlatformAuthController, PlatformTenantsController],
  providers: [PlatformAuthService, PlatformJwtStrategy, PlatformGuard, PlatformTenantsService],
})
export class PlatformModule {}
```

(Les fichiers `platform-tenants.*` arrivent en Task 6 — créer le module à la fin de la Task 6 si l'ordre d'exécution est strict, ou créer des fichiers vides compilables d'abord.)

Dans `apps/api/src/app.module.ts` : ajouter `PlatformModule` à la liste des imports core (après `ModuleRegistryModule`) avec son import en tête de fichier :

```ts
import { PlatformModule } from './core/platform/platform.module';
```

- [ ] **Step 3: Typecheck + commit (après Task 6 si fichiers tenants requis)**

Run: `pnpm --filter @pulsar/api typecheck`

```bash
git add apps/api/src/core/platform/ apps/api/src/app.module.ts
git commit -m "feat(api): platform auth (12h token, no refresh)"
```

---

### Task 6: Gestion des tenants (list/get/create/suspend/reactivate)

**Files:**
- Create: `apps/api/src/core/platform/platform-tenants.service.ts`
- Create: `apps/api/src/core/platform/platform-tenants.controller.ts`
- Create: `apps/api/src/core/platform/dto/create-platform-tenant.dto.ts`

- [ ] **Step 1: DTO**

`apps/api/src/core/platform/dto/create-platform-tenant.dto.ts` :

```ts
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

class PlatformTenantAdminDto {
  @IsEmail()
  email!: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;
}

export class CreatePlatformTenantDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, {
    message: 'slug must be lowercase letters, digits and dashes',
  })
  slug!: string;

  @IsString()
  name!: string;

  /** Business module keys to enable (core is always enabled). */
  @IsArray()
  @IsString({ each: true })
  modules!: string[];

  @ValidateNested()
  @Type(() => PlatformTenantAdminDto)
  admin!: PlatformTenantAdminDto;
}
```

- [ ] **Step 2: Service**

`apps/api/src/core/platform/platform-tenants.service.ts` :

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, MODULE_CATALOG, MODULE_KEYS } from '@pulsar/shared';
import { hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePlatformTenantDto } from './dto/create-platform-tenant.dto';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class PlatformTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly audit: AuditLogsService,
  ) {}

  async list() {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { users: true } },
        modules: { where: { enabled: true }, include: { module: true } },
      },
    });
    return tenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
      createdAt: t.createdAt,
      userCount: t._count.users,
      enabledModules: t.modules.map((m) => m.module.key),
    }));
  }

  async get(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true } },
        modules: { where: { enabled: true }, include: { module: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      createdAt: tenant.createdAt,
      userCount: tenant._count.users,
      enabledModules: tenant.modules.map((m) => m.module.key),
    };
  }

  /**
   * Mirrors the seed: tenant + admin role (all catalog permissions) + INVITED
   * admin user with a 72 h invitation link + requested modules enabled.
   */
  async create(platformActor: string, dto: CreatePlatformTenantDto) {
    const existing = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException(`Tenant slug "${dto.slug}" already exists`);

    const availableKeys = MODULE_CATALOG.filter((m) => m.available).map((m) => m.key);
    for (const key of dto.modules) {
      if (!availableKeys.includes(key as (typeof availableKeys)[number])) {
        throw new BadRequestException(`Module "${key}" is not available`);
      }
    }
    const moduleKeys = [...new Set([MODULE_KEYS.CORE, ...dto.modules])];

    const inviteToken = randomBytes(32).toString('base64url');
    const tenant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: { slug: dto.slug, name: dto.name, status: 'ACTIVE' },
      });

      const definitions = await tx.moduleDefinition.findMany({
        where: { key: { in: moduleKeys } },
      });
      for (const def of definitions) {
        await tx.tenantModule.create({
          data: { tenantId: created.id, moduleId: def.id, enabled: true, enabledAt: new Date() },
        });
      }

      const role = await tx.role.create({
        data: {
          tenantId: created.id,
          key: 'admin',
          name: 'Administrator',
          description: 'Full access to all modules',
          isSystem: true,
        },
      });
      const permissions = await tx.permission.findMany();
      await tx.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });

      const admin = await tx.user.create({
        data: {
          tenantId: created.id,
          email: dto.admin.email.toLowerCase(),
          passwordHash: await hash(randomBytes(32).toString('hex'), 10),
          firstName: dto.admin.firstName,
          lastName: dto.admin.lastName,
          status: 'INVITED',
          roles: { create: [{ roleId: role.id }] },
        },
      });
      await tx.userActionToken.create({
        data: {
          userId: admin.id,
          kind: 'INVITATION',
          tokenHash: sha256(inviteToken),
          expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        },
      });
      return created;
    });

    const inviteUrl = `${this.config.get('WEB_URL', 'http://localhost:5173')}/reset-password/${inviteToken}`;
    await this.email.send({
      to: dto.admin.email,
      subject: `Your ${dto.name} workspace on Pulsar is ready`,
      html: `<p>Set your password to activate your administrator account: <a href="${inviteUrl}">${inviteUrl}</a></p><p>This link expires in 72 hours.</p>`,
      text: `Activate your Pulsar administrator account: ${inviteUrl} (expires in 72 hours)`,
    });
    await this.audit.log({
      tenantId: tenant.id,
      userId: null,
      action: AuditAction.CREATE,
      entityType: 'tenant',
      entityId: tenant.id,
      after: { slug: tenant.slug, name: tenant.name, modules: moduleKeys, platformActor },
    });
    return { ...(await this.get(tenant.id)), inviteUrl };
  }

  async suspend(platformActor: string, id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status === 'SUSPENDED') {
      throw new BadRequestException('Tenant is already suspended');
    }
    await this.prisma.$transaction([
      this.prisma.tenant.update({ where: { id }, data: { status: 'SUSPENDED' } }),
      // Active sessions die with the tenant: no refresh possible while suspended.
      this.prisma.refreshToken.updateMany({
        where: { revokedAt: null, user: { tenantId: id } },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.log({
      tenantId: id,
      userId: null,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'tenant',
      entityId: id,
      before: { status: tenant.status },
      after: { status: 'SUSPENDED', platformActor },
    });
    return this.get(id);
  }

  async reactivate(platformActor: string, id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status !== 'SUSPENDED') {
      throw new BadRequestException('Only suspended tenants can be reactivated');
    }
    await this.prisma.tenant.update({ where: { id }, data: { status: 'ACTIVE' } });
    await this.audit.log({
      tenantId: id,
      userId: null,
      action: AuditAction.STATUS_CHANGE,
      entityType: 'tenant',
      entityId: id,
      before: { status: 'SUSPENDED' },
      after: { status: 'ACTIVE', platformActor },
    });
    return this.get(id);
  }
}
```

- [ ] **Step 3: Controller**

`apps/api/src/core/platform/platform-tenants.controller.ts` :

```ts
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CreatePlatformTenantDto } from './dto/create-platform-tenant.dto';
import { PlatformGuard } from './platform.guard';
import { PlatformTenantsService } from './platform-tenants.service';

interface PlatformRequest {
  user: { id: string; email: string };
}

/**
 * Cross-tenant operations. @Public() skips the global tenant JwtAuthGuard;
 * PlatformGuard then enforces a *platform* token (and live ACTIVE status).
 */
@ApiTags('platform')
@ApiBearerAuth()
@Public()
@UseGuards(PlatformGuard)
@Controller('platform/tenants')
export class PlatformTenantsController {
  constructor(private readonly tenants: PlatformTenantsService) {}

  @Get()
  list() {
    return this.tenants.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.tenants.get(id);
  }

  @Post()
  create(@Req() req: PlatformRequest, @Body() dto: CreatePlatformTenantDto) {
    return this.tenants.create(req.user.email, dto);
  }

  @Post(':id/suspend')
  suspend(@Req() req: PlatformRequest, @Param('id') id: string) {
    return this.tenants.suspend(req.user.email, id);
  }

  @Post(':id/reactivate')
  reactivate(@Req() req: PlatformRequest, @Param('id') id: string) {
    return this.tenants.reactivate(req.user.email, id);
  }
}
```

- [ ] **Step 4: Typecheck + tests + commit**

Run: `pnpm --filter @pulsar/api typecheck && pnpm --filter @pulsar/api test`
Expected: exit 0 / PASS

```bash
git add apps/api/src/core/platform/
git commit -m "feat(api): platform tenant management (create/suspend/reactivate)"
```

---

### Task 7: Web — pages plateforme

Pas de refresh transparent : client API minimal dédié, token dans `localStorage` sous une clé distincte de la session tenant.

**Files:**
- Create: `apps/web/src/lib/api/platform.ts`
- Create: `apps/web/src/routes/platform/+layout.svelte`
- Create: `apps/web/src/routes/platform/login/+page.svelte`
- Create: `apps/web/src/routes/platform/tenants/+page.svelte`

- [ ] **Step 1: Client API plateforme**

`apps/web/src/lib/api/platform.ts` :

```ts
import { goto } from '$app/navigation';

const BASE = '/api/v1';
const TOKEN_KEY = 'pulsar_platform_token';

export const getPlatformToken = () => localStorage.getItem(TOKEN_KEY);
export const setPlatformToken = (token: string) => localStorage.setItem(TOKEN_KEY, token);
export const clearPlatformToken = () => localStorage.removeItem(TOKEN_KEY);

export class PlatformApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** Minimal client for the platform plane: Bearer token, no refresh (12 h token). */
export async function platformApi<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = getPlatformToken();
  const response = await fetch(BASE + path, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 401 && !path.endsWith('/auth/login')) {
    clearPlatformToken();
    void goto('/platform/login');
    throw new PlatformApiError(401, 'Platform session expired');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = Array.isArray(payload?.message)
      ? payload.message.join(', ')
      : (payload?.message ?? response.statusText);
    throw new PlatformApiError(response.status, message);
  }
  return (await response.json()) as T;
}
```

- [ ] **Step 2: Layout + login**

`apps/web/src/routes/platform/+layout.svelte` :

```svelte
<script lang="ts">
  let { children } = $props();
</script>

<div style="max-width: 960px; margin: 0 auto; padding: 24px;">
  <header style="display: flex; justify-content: space-between; margin-bottom: 24px;">
    <h2 style="margin: 0;">Pulsar — Platform</h2>
  </header>
  {@render children()}
</div>
```

`apps/web/src/routes/platform/login/+page.svelte` :

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { platformApi, PlatformApiError, setPlatformToken } from '$lib/api/platform';

  let email = $state('');
  let password = $state('');
  let error = $state('');

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    try {
      const result = await platformApi<{ accessToken: string }>('/platform/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      setPlatformToken(result.accessToken);
      void goto('/platform/tenants');
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : 'Login failed';
    }
  }
</script>

<div class="card" style="max-width: 360px; margin: 64px auto; padding: 24px;">
  <h1>Platform sign-in</h1>
  <form onsubmit={submit}>
    <label>Email <input type="email" bind:value={email} required /></label>
    <label>Password <input type="password" bind:value={password} required /></label>
    {#if error}<p class="error-text">{error}</p>{/if}
    <button class="btn" type="submit">Sign in</button>
  </form>
</div>
```

- [ ] **Step 3: Page tenants (liste + création + suspension)**

`apps/web/src/routes/platform/tenants/+page.svelte` :

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { getPlatformToken, platformApi, PlatformApiError } from '$lib/api/platform';
  import StatusBadge from '$lib/components/StatusBadge.svelte';

  interface TenantRow {
    id: string;
    slug: string;
    name: string;
    status: string;
    userCount: number;
    enabledModules: string[];
  }

  let tenants = $state<TenantRow[]>([]);
  let error = $state('');
  let inviteUrl = $state('');
  let showForm = $state(false);

  let slug = $state('');
  let name = $state('');
  let adminEmail = $state('');
  let adminFirstName = $state('');
  let adminLastName = $state('');
  let modules = $state<string[]>(['transportation']);
  const availableModules = ['transportation', 'customer-portal', 'billing'];

  async function load() {
    if (!getPlatformToken()) {
      void goto('/platform/login');
      return;
    }
    try {
      tenants = await platformApi<TenantRow[]>('/platform/tenants');
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : 'Failed to load tenants';
    }
  }

  async function createTenant(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    try {
      const created = await platformApi<TenantRow & { inviteUrl: string }>('/platform/tenants', {
        method: 'POST',
        body: {
          slug,
          name,
          modules,
          admin: { email: adminEmail, firstName: adminFirstName, lastName: adminLastName },
        },
      });
      inviteUrl = created.inviteUrl;
      showForm = false;
      await load();
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : 'Failed to create tenant';
    }
  }

  async function setStatus(tenant: TenantRow, action: 'suspend' | 'reactivate') {
    error = '';
    try {
      await platformApi(`/platform/tenants/${tenant.id}/${action}`, { method: 'POST' });
      await load();
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : `Failed to ${action}`;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="page-header">
  <h1>Tenants</h1>
  <button class="btn" onclick={() => (showForm = !showForm)}>
    {showForm ? 'Cancel' : 'New tenant'}
  </button>
</div>

{#if error}<p class="error-text">{error}</p>{/if}
{#if inviteUrl}
  <div class="card" style="padding: 12px; margin-bottom: 16px;">
    <strong>Tenant created.</strong> Admin invitation link (also emailed):
    <code style="word-break: break-all;">{inviteUrl}</code>
  </div>
{/if}

{#if showForm}
  <form class="card" style="padding: 16px; margin-bottom: 16px;" onsubmit={createTenant}>
    <label>Slug <input bind:value={slug} required pattern="[a-z0-9-]+" /></label>
    <label>Name <input bind:value={name} required /></label>
    <fieldset>
      <legend>Modules</legend>
      {#each availableModules as key (key)}
        <label style="display: inline-flex; gap: 4px; margin-right: 12px;">
          <input type="checkbox" value={key} bind:group={modules} />{key}
        </label>
      {/each}
    </fieldset>
    <label>Admin email <input type="email" bind:value={adminEmail} required /></label>
    <label>Admin first name <input bind:value={adminFirstName} required /></label>
    <label>Admin last name <input bind:value={adminLastName} required /></label>
    <button class="btn" type="submit">Create</button>
  </form>
{/if}

<div class="card" style="padding: 0;">
  <table>
    <thead>
      <tr><th>Slug</th><th>Name</th><th>Status</th><th>Users</th><th>Modules</th><th></th></tr>
    </thead>
    <tbody>
      {#each tenants as tenant (tenant.id)}
        <tr>
          <td><strong>{tenant.slug}</strong></td>
          <td>{tenant.name}</td>
          <td><StatusBadge status={tenant.status} /></td>
          <td>{tenant.userCount}</td>
          <td>{tenant.enabledModules.join(', ')}</td>
          <td style="text-align: right;">
            {#if tenant.status === 'SUSPENDED'}
              <button class="btn btn-sm" onclick={() => setStatus(tenant, 'reactivate')}>
                Reactivate
              </button>
            {:else}
              <button class="btn btn-sm" onclick={() => setStatus(tenant, 'suspend')}>
                Suspend
              </button>
            {/if}
          </td>
        </tr>
      {:else}
        <tr><td colspan="6" class="muted">No tenants.</td></tr>
      {/each}
    </tbody>
  </table>
</div>
```

- [ ] **Step 4: Typecheck web + commit**

Run: `pnpm --filter @pulsar/web typecheck`
Expected: exit 0 (ajuster les imports si le check du projet utilise `svelte-check`).

```bash
git add apps/web/src/lib/api/platform.ts apps/web/src/routes/platform/
git commit -m "feat(web): platform plane pages (login, tenants)"
```

---

### Task 8: Suite e2e plateforme

**Files:**
- Create: `apps/api/test/phase6-platform.e2e-spec.ts`

- [ ] **Step 1: Écrire la suite (suivre le harnais de `phase5.e2e-spec.ts`)**

`apps/api/test/phase6-platform.e2e-spec.ts` :

```ts
/**
 * E2E for phase 6 — platform plane: platform login, tenant creation (with
 * consumable admin invitation), suspension gating tenant login, watertight
 * token separation, and live status re-read on the PlatformGuard.
 * Prerequisites: reachable PostgreSQL with the seed applied.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Phase 6 — platform plane (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let platformToken: string;
  let tenantId = '';
  let inviteToken = '';

  const suffix = `p6${Date.now().toString(36)}`;
  const slug = `${suffix}-corp`;
  const adminEmail = `${suffix}-admin@example.test`;
  const platformAuth = () => ({ Authorization: `Bearer ${platformToken}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('platform admin signs in (12h token, no refresh token)', async () => {
    const res = await request(http)
      .post('/api/v1/platform/auth/login')
      .send({ email: 'platform@pulsar.dev', password: 'admin123' })
      .expect(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeUndefined();
    platformToken = res.body.accessToken;
  });

  it('rejects a tenant token on platform routes and vice versa', async () => {
    const tenantLogin = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    await request(http)
      .get('/api/v1/platform/tenants')
      .set({ Authorization: `Bearer ${tenantLogin.body.accessToken}` })
      .expect(401);
    await request(http).get('/api/v1/auth/me').set(platformAuth()).expect(401);
  });

  it('creates a tenant with modules, admin role and invitation', async () => {
    const res = await request(http)
      .post('/api/v1/platform/tenants')
      .set(platformAuth())
      .send({
        slug,
        name: 'Phase6 Corp',
        modules: ['transportation', 'billing'],
        admin: { email: adminEmail, firstName: 'Ada', lastName: 'Admin' },
      })
      .expect(201);
    tenantId = res.body.id;
    expect(res.body.enabledModules).toEqual(
      expect.arrayContaining(['core', 'transportation', 'billing']),
    );
    expect(res.body.inviteUrl).toContain('/reset-password/');
    inviteToken = res.body.inviteUrl.split('/reset-password/')[1];
  });

  it('the invited admin consumes the invitation and signs in', async () => {
    await request(http)
      .post('/api/v1/auth/reset-password')
      .send({ token: inviteToken, password: 'NewP@ss123' })
      .expect(201);
    await request(http)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: 'NewP@ss123', tenant: slug })
      .expect(200);
  });

  it('suspension blocks tenant login; reactivation restores it', async () => {
    await request(http)
      .post(`/api/v1/platform/tenants/${tenantId}/suspend`)
      .set(platformAuth())
      .expect(201);
    await request(http)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: 'NewP@ss123', tenant: slug })
      .expect(401);
    await request(http)
      .post(`/api/v1/platform/tenants/${tenantId}/reactivate`)
      .set(platformAuth())
      .expect(201);
    await request(http)
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password: 'NewP@ss123', tenant: slug })
      .expect(200);
  });

  it('a DISABLED platform admin loses access on the next request', async () => {
    const email = 'platform@pulsar.dev';
    await prisma.platformUser.update({ where: { email }, data: { status: 'DISABLED' } });
    try {
      await request(http).get('/api/v1/platform/tenants').set(platformAuth()).expect(401);
    } finally {
      await prisma.platformUser.update({ where: { email }, data: { status: 'ACTIVE' } });
    }
  });
});
```

Note : l'endpoint reset-password répond 201 (POST par défaut Nest) — vérifier le code réel de `auth.controller.ts` et ajuster `.expect()` si l'existant renvoie 200 (le flux invitation existant de phase 3 fait foi).

- [ ] **Step 2: Lancer (DB seedée)**

Run: `pnpm test:e2e`
Expected: la nouvelle suite passe, les anciennes restent vertes.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/phase6-platform.e2e-spec.ts
git commit -m "test(api): platform plane e2e suite"
```

---

### Task 9: Vérification finale du plan B

- [ ] **Step 1: Tout relancer**

```bash
pnpm typecheck && pnpm test && pnpm test:e2e
```

Expected: exit 0 partout.

- [ ] **Step 2: Vérification manuelle UI**

`pnpm dev`, ouvrir `http://localhost:5173/platform/login`, se connecter (`platform@pulsar.dev` / `admin123`), créer un tenant de test, vérifier le lien d'invitation affiché, suspendre/réactiver.
