# Phase 6C — SSO OIDC par tenant : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Login OIDC par tenant (`GET /auth/oidc/:tenantSlug` → IdP → callback → même paire access/refresh qu'au login), config chiffrée par tenant, provisioning au premier login, liaison par claim `sub`.

**Architecture:** Config dans `Tenant.authConfig` (Json) avec `clientSecret` chiffré (CryptoService du plan 6A). Lib `openid-client@^5` (API `Issuer`/`Client` stable). L'état du flow (code_verifier PKCE + nonce + horodatage) voyage dans le paramètre `state` lui-même, **chiffré** avec CryptoService — pas de stockage serveur ni de cookie. Le callback remet un code d'échange one-shot 60 s (`UserActionToken` kind `OIDC_EXCHANGE`) ; le SPA le troque contre la `LoginResponse` via `POST /auth/oidc/exchange` (émise par `AuthService.issueSession`, l'API d'émission isolée). Aucun token dans une URL.

**Tech Stack:** NestJS 11, openid-client ^5, Prisma, CryptoService (plan 6A), SvelteKit.

**Référence spec:** spec phase 6 section 2. **Dépendances:** plan 6A (CryptoService, jest unitaire). **Déviation assumée vs spec:** le spec prévoyait un *cookie signé* pour state/nonce/PKCE ; on met ces valeurs dans un `state` chiffré AES-GCM (équivalent fonctionnel, zéro dépendance cookie-parser, le `nonce` vérifié dans l'ID token lie la réponse à notre requête). À documenter dans le spec à la fin du plan (Task 9).

---

### Task 1: Schéma — authConfig, oidcSubject, OIDC_EXCHANGE

**Files:**
- Modify: `packages/database/prisma/schema.prisma`

- [ ] **Step 1: Éditer le schéma**

1. Modèle `Tenant` — ajouter après `settings` :

```prisma
  // OIDC SSO config: { enabled, issuer, clientId, clientSecret (enc:v1), defaultRoleId }
  authConfig Json?
```

2. Modèle `User` — ajouter après `status` :

```prisma
  // Stable OIDC identifier (ID token "sub"); email is only a first-login fallback.
  oidcSubject String?
```

et dans le bloc des contraintes du modèle `User`, ajouter :

```prisma
  @@unique([tenantId, oidcSubject])
```

3. Enum `UserActionTokenKind` — ajouter la valeur :

```prisma
  OIDC_EXCHANGE
```

- [ ] **Step 2: Migrer + rebuild**

Run: `pnpm db:migrate` (nom : `oidc_sso`) puis `pnpm --filter @pulsar/database build`
Expected: migration appliquée, client régénéré.

- [ ] **Step 3: Commit**

```bash
git add packages/database/prisma/
git commit -m "feat(db): tenant authConfig, user oidcSubject, OIDC_EXCHANGE token kind"
```

---

### Task 2: AuthService — exposer l'émission de session

**Files:**
- Modify: `apps/api/src/core/auth/auth.service.ts`

- [ ] **Step 1: Renommer `buildSession` (privé) en `issueSession` (public)**

Dans `apps/api/src/core/auth/auth.service.ts` :
- `private async buildSession(userId: string)` devient `async issueSession(userId: string)` ;
- mettre à jour les deux appels internes (`login` → `return this.issueSession(user.id);`, `refresh` → `return this.issueSession(record.userId);`) ;
- ajouter au-dessus de la méthode :

```ts
  /**
   * Single session-issuance path (access + rotating refresh pair). Used by
   * password login, refresh, and the OIDC exchange — any new auth method must
   * go through here so session semantics stay identical.
   */
```

- [ ] **Step 2: Typecheck + tests + commit**

Run: `pnpm --filter @pulsar/api typecheck && pnpm --filter @pulsar/api test`
Expected: OK.

```bash
git add apps/api/src/core/auth/auth.service.ts
git commit -m "refactor(api): expose AuthService.issueSession for OIDC"
```

---

### Task 3: Types et état chiffré du flow (TDD)

**Files:**
- Create: `apps/api/src/core/auth/oidc/oidc-state.ts`
- Test: `apps/api/src/core/auth/oidc/oidc-state.spec.ts`

- [ ] **Step 1: Test qui échoue**

`apps/api/src/core/auth/oidc/oidc-state.spec.ts` :

```ts
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../../crypto/crypto.service';
import { packOidcState, unpackOidcState } from './oidc-state';

const crypto = new CryptoService({
  get: () => Buffer.alloc(32, 3).toString('base64'),
} as unknown as ConfigService);

describe('oidc state', () => {
  it('round-trips verifier and nonce', () => {
    const state = packOidcState(crypto, { verifier: 'v', nonce: 'n', issuedAt: Date.now() });
    const unpacked = unpackOidcState(crypto, state);
    expect(unpacked.verifier).toBe('v');
    expect(unpacked.nonce).toBe('n');
  });

  it('rejects an expired state (10 min)', () => {
    const state = packOidcState(crypto, {
      verifier: 'v',
      nonce: 'n',
      issuedAt: Date.now() - 11 * 60_000,
    });
    expect(() => unpackOidcState(crypto, state)).toThrow(/expired/i);
  });

  it('rejects a tampered state', () => {
    expect(() => unpackOidcState(crypto, 'enc:v1:AAAA:BBBB:CCCC')).toThrow();
  });
});
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `pnpm --filter @pulsar/api test`
Expected: FAIL — `./oidc-state` introuvable.

- [ ] **Step 3: Implémenter**

`apps/api/src/core/auth/oidc/oidc-state.ts` :

```ts
import { CryptoService } from '../../crypto/crypto.service';

export interface OidcFlowState {
  /** PKCE code_verifier */
  verifier: string;
  nonce: string;
  issuedAt: number;
}

const MAX_AGE_MS = 10 * 60_000;

/**
 * The whole flow state travels inside the OAuth `state` parameter, encrypted
 * (AES-GCM): stateless server, tamper-proof (GCM auth tag), and the nonce check
 * against the ID token binds the callback to this exact authorization request.
 */
export function packOidcState(crypto: CryptoService, state: OidcFlowState): string {
  return crypto.encryptString(JSON.stringify(state));
}

export function unpackOidcState(crypto: CryptoService, raw: string): OidcFlowState {
  const state = JSON.parse(crypto.decryptString(raw)) as OidcFlowState;
  if (Date.now() - state.issuedAt > MAX_AGE_MS) {
    throw new Error('OIDC state expired');
  }
  return state;
}
```

- [ ] **Step 4: Lancer, vérifier le succès, commit**

Run: `pnpm --filter @pulsar/api test`
Expected: PASS

```bash
git add apps/api/src/core/auth/oidc/
git commit -m "feat(api): encrypted stateless OIDC flow state"
```

---

### Task 4: OidcService — config + flow (TDD sur la logique de provisioning)

**Files:**
- Create: `apps/api/src/core/auth/oidc/oidc.service.ts`
- Test: `apps/api/src/core/auth/oidc/oidc.service.spec.ts`
- Modify: `apps/api/src/core/auth/auth.module.ts`

- [ ] **Step 1: Installer openid-client**

Run: `pnpm --filter @pulsar/api add openid-client@^5.7.0`

- [ ] **Step 2: Test du provisioning/liaison (échoue)**

La résolution utilisateur est extraite en fonction pure testable : `resolveOidcUser(tx, tenantId, claims, defaultRoleId)` n'est pas mockée — on teste la méthode `lookupOrProvision` du service avec un Prisma factice.

`apps/api/src/core/auth/oidc/oidc.service.spec.ts` :

```ts
import { UnauthorizedException } from '@nestjs/common';
import { OidcService } from './oidc.service';

type AnyRecord = Record<string, unknown>;

function fakePrisma(users: AnyRecord[]) {
  const created: AnyRecord[] = [];
  const updated: AnyRecord[] = [];
  return {
    created,
    updated,
    user: {
      findFirst: async ({ where }: { where: AnyRecord }) => {
        if (where.oidcSubject) {
          return users.find((u) => u.oidcSubject === where.oidcSubject) ?? null;
        }
        return users.find((u) => u.email === where.email) ?? null;
      },
      update: async ({ where, data }: { where: AnyRecord; data: AnyRecord }) => {
        updated.push({ ...where, ...data });
        return { ...users[0], ...data };
      },
      create: async ({ data }: { data: AnyRecord }) => {
        const user = { id: 'new-user', ...data };
        created.push(user);
        return user;
      },
    },
  };
}

const service = Object.create(OidcService.prototype) as OidcService;

describe('OidcService.lookupOrProvision', () => {
  const claims = { sub: 'idp-sub-1', email: 'jane@corp.test', given_name: 'Jane' };

  it('matches by oidcSubject first', async () => {
    const prisma = fakePrisma([
      { id: 'u1', email: 'old@corp.test', oidcSubject: 'idp-sub-1', status: 'ACTIVE' },
    ]);
    const { user, provisioned } = await service.lookupOrProvision(
      prisma as never,
      't1',
      claims,
      'role1',
    );
    expect(user.id).toBe('u1');
    expect(provisioned).toBe(false);
    expect(prisma.created).toHaveLength(0);
  });

  it('falls back to email and binds the subject', async () => {
    const prisma = fakePrisma([
      { id: 'u2', email: 'jane@corp.test', oidcSubject: null, status: 'ACTIVE' },
    ]);
    const { provisioned } = await service.lookupOrProvision(prisma as never, 't1', claims, 'role1');
    expect(provisioned).toBe(false);
    expect(prisma.updated[0]).toMatchObject({ id: 'u2', oidcSubject: 'idp-sub-1' });
  });

  it('provisions a new ACTIVE user with the default role', async () => {
    const prisma = fakePrisma([]);
    const { user, provisioned } = await service.lookupOrProvision(
      prisma as never,
      't1',
      claims,
      'role1',
    );
    expect(user.id).toBe('new-user');
    expect(provisioned).toBe(true);
    expect(prisma.created[0]).toMatchObject({
      tenantId: 't1',
      email: 'jane@corp.test',
      oidcSubject: 'idp-sub-1',
      status: 'ACTIVE',
    });
  });

  it('refuses a DISABLED user', async () => {
    const prisma = fakePrisma([
      { id: 'u3', email: 'jane@corp.test', oidcSubject: 'idp-sub-1', status: 'DISABLED' },
    ]);
    await expect(
      service.lookupOrProvision(prisma as never, 't1', claims, 'role1'),
    ).rejects.toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 3: Lancer, vérifier l'échec**

Run: `pnpm --filter @pulsar/api test`
Expected: FAIL.

- [ ] **Step 4: Implémenter le service**

`apps/api/src/core/auth/oidc/oidc.service.ts` :

```ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LoginResponse } from '@pulsar/shared';
import { AuditAction } from '@pulsar/shared';
import { hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { generators, Issuer } from 'openid-client';
import { AuditLogsService } from '../../audit-logs/audit-logs.service';
import { CryptoService } from '../../crypto/crypto.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthService } from '../auth.service';
import { packOidcState, unpackOidcState } from './oidc-state';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const MASK = '***';

export interface OidcConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  /** Stored encrypted (enc:v1). */
  clientSecret: string;
  defaultRoleId: string;
}

export interface OidcClaims {
  sub: string;
  email?: string;
  given_name?: string;
  family_name?: string;
}

@Injectable()
export class OidcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly audit: AuditLogsService,
  ) {}

  // --- Tenant admin config ---------------------------------------------------

  async getConfig(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const stored = tenant.authConfig as OidcConfig | null;
    if (!stored) return { enabled: false, issuer: '', clientId: '', clientSecret: '', defaultRoleId: '' };
    return { ...stored, clientSecret: stored.clientSecret ? MASK : '' };
  }

  async putConfig(tenantId: string, input: OidcConfig) {
    const role = await this.prisma.role.findFirst({
      where: { id: input.defaultRoleId, tenantId },
    });
    if (!role) throw new BadRequestException('defaultRoleId does not belong to this tenant');

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const stored = tenant.authConfig as OidcConfig | null;
    const clientSecret =
      input.clientSecret === MASK && stored
        ? stored.clientSecret // client echoed the mask: keep the stored secret
        : this.crypto.encryptString(input.clientSecret);

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { authConfig: { ...input, clientSecret } },
    });
    return this.getConfig(tenantId);
  }

  // --- Flow --------------------------------------------------------------------

  private async tenantWithOidc(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    const config = tenant?.authConfig as OidcConfig | null;
    if (!tenant || tenant.status === 'SUSPENDED' || !config?.enabled) {
      throw new NotFoundException('SSO is not enabled for this organization');
    }
    return { tenant, config };
  }

  private async clientFor(config: OidcConfig, slug: string) {
    const issuer = await Issuer.discover(config.issuer);
    const apiUrl = this.config.get('API_URL', 'http://localhost:3000');
    return new issuer.Client({
      client_id: config.clientId,
      client_secret: this.crypto.decryptString(config.clientSecret),
      redirect_uris: [`${apiUrl}/api/v1/auth/oidc/${slug}/callback`],
      response_types: ['code'],
    });
  }

  /** Step 1: build the IdP authorization URL (PKCE + nonce inside encrypted state). */
  async start(slug: string): Promise<string> {
    const { config } = await this.tenantWithOidc(slug);
    const client = await this.clientFor(config, slug);
    const verifier = generators.codeVerifier();
    const nonce = generators.nonce();
    return client.authorizationUrl({
      scope: 'openid email profile',
      code_challenge: generators.codeChallenge(verifier),
      code_challenge_method: 'S256',
      nonce,
      state: packOidcState(this.crypto, { verifier, nonce, issuedAt: Date.now() }),
    });
  }

  /** Step 2: IdP callback — exchange the code, resolve the user, mint a one-shot exchange code. */
  async callback(slug: string, params: Record<string, string>): Promise<string> {
    const { tenant, config } = await this.tenantWithOidc(slug);
    const client = await this.clientFor(config, slug);
    const state = unpackOidcState(this.crypto, params.state ?? '');
    const apiUrl = this.config.get('API_URL', 'http://localhost:3000');
    const tokenSet = await client.callback(
      `${apiUrl}/api/v1/auth/oidc/${slug}/callback`,
      params,
      { state: params.state, nonce: state.nonce, code_verifier: state.verifier },
    );
    const claims = tokenSet.claims() as OidcClaims;
    if (!claims.email) throw new UnauthorizedException('IdP did not provide an email claim');

    const { user, provisioned } = await this.prisma.$transaction(async (tx) =>
      this.lookupOrProvision(tx as never, tenant.id, claims, config.defaultRoleId),
    );

    const code = randomBytes(32).toString('base64url');
    await this.prisma.userActionToken.create({
      data: {
        userId: user.id,
        kind: 'OIDC_EXCHANGE',
        tokenHash: sha256(code),
        expiresAt: new Date(Date.now() + 60_000), // one-shot, 60 s
      },
    });
    await this.audit.log({
      tenantId: tenant.id,
      userId: user.id,
      action: AuditAction.LOGIN,
      entityType: 'user',
      entityId: user.id,
      after: { method: 'oidc', provisioned },
    });
    const webUrl = this.config.get('WEB_URL', 'http://localhost:5173');
    return `${webUrl}/oidc/complete?code=${code}`;
  }

  /** Step 3: the SPA trades the one-shot code for the standard session pair. */
  async exchange(code: string): Promise<LoginResponse> {
    const tokenHash = sha256(code);
    // Atomic one-shot claim: the conditional UPDATE is the uniqueness guarantee.
    // A read-then-write pair would let two concurrent exchanges both pass the
    // usedAt check; here only one request can match usedAt: null.
    const claimed = await this.prisma.userActionToken.updateMany({
      where: { tokenHash, kind: 'OIDC_EXCHANGE', usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new UnauthorizedException('Invalid or expired exchange code');
    }
    const record = await this.prisma.userActionToken.findUniqueOrThrow({ where: { tokenHash } });
    return this.auth.issueSession(record.userId);
  }

  // --- User resolution (unit-tested) -------------------------------------------

  /** sub first; email fallback binds the sub; otherwise provision ACTIVE + default role. */
  async lookupOrProvision(
    tx: Pick<PrismaService, 'user'>,
    tenantId: string,
    claims: OidcClaims,
    defaultRoleId: string,
  ): Promise<{ user: { id: string }; provisioned: boolean }> {
    const bySub = await tx.user.findFirst({
      where: { tenantId, oidcSubject: claims.sub },
    });
    if (bySub) {
      if (bySub.status === 'DISABLED') throw new UnauthorizedException('Account is disabled');
      return { user: bySub, provisioned: false };
    }
    const byEmail = claims.email
      ? await tx.user.findFirst({ where: { tenantId, email: claims.email.toLowerCase() } })
      : null;
    if (byEmail) {
      if (byEmail.status === 'DISABLED') throw new UnauthorizedException('Account is disabled');
      const bound = await tx.user.update({
        where: { id: byEmail.id },
        data: { oidcSubject: claims.sub, status: 'ACTIVE' },
      });
      return { user: bound, provisioned: false };
    }
    const created = await tx.user.create({
      data: {
        tenantId,
        email: claims.email!.toLowerCase(),
        oidcSubject: claims.sub,
        passwordHash: await hash(randomBytes(32).toString('hex'), 10),
        firstName: claims.given_name ?? '',
        lastName: claims.family_name ?? '',
        status: 'ACTIVE',
        roles: { create: [{ roleId: defaultRoleId }] },
      },
    });
    return { user: created, provisioned: true };
  }
}
```

Note d'implémentation : le test unitaire instancie via `Object.create(OidcService.prototype)` — `lookupOrProvision` ne touche aucune dépendance injectée, c'est voulu ; si l'implémentation finale en utilise, basculer le test sur un constructeur avec mocks.

- [ ] **Step 5: Lancer, vérifier le succès**

Run: `pnpm --filter @pulsar/api test`
Expected: PASS.

- [ ] **Step 6: Ajouter `API_URL` à `.env.example`** (bloc `# --- API ---`)

```
# Public base URL of the API (used to build OIDC redirect URIs)
API_URL=http://localhost:3000
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/core/auth/oidc/ apps/api/package.json pnpm-lock.yaml .env.example
git commit -m "feat(api): OIDC service (config, PKCE flow, sub-first provisioning)"
```

---

### Task 5: Contrôleur OIDC + enregistrement module

**Files:**
- Create: `apps/api/src/core/auth/oidc/oidc.controller.ts`
- Modify: `apps/api/src/core/auth/auth.module.ts`

- [ ] **Step 1: Contrôleur**

`apps/api/src/core/auth/oidc/oidc.controller.ts` :

```ts
import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { PERMISSIONS } from '@pulsar/shared';
import type { Response } from 'express';
import { IsBoolean, IsString } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { OidcService } from './oidc.service';

class OidcConfigDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  issuer!: string;

  @IsString()
  clientId!: string;

  @IsString()
  clientSecret!: string;

  @IsString()
  defaultRoleId!: string;
}

class OidcExchangeDto {
  @IsString()
  code!: string;
}

@ApiTags('auth')
@Controller('auth')
export class OidcController {
  constructor(private readonly oidc: OidcService) {}

  @Get('oidc-config')
  @RequirePermissions(PERMISSIONS.CORE.TENANT_MANAGE)
  getConfig(@CurrentUser() user: AuthUser) {
    return this.oidc.getConfig(user.tenantId);
  }

  @Put('oidc-config')
  @RequirePermissions(PERMISSIONS.CORE.TENANT_MANAGE)
  putConfig(@CurrentUser() user: AuthUser, @Body() dto: OidcConfigDto) {
    return this.oidc.putConfig(user.tenantId, dto);
  }

  @Public()
  @Get('oidc/:tenantSlug')
  async start(@Param('tenantSlug') slug: string, @Res() res: Response) {
    res.redirect(await this.oidc.start(slug));
  }

  @Public()
  @Get('oidc/:tenantSlug/callback')
  async callback(
    @Param('tenantSlug') slug: string,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    res.redirect(await this.oidc.callback(slug, query));
  }

  @Public()
  @Post('oidc/exchange')
  exchange(@Body() dto: OidcExchangeDto) {
    return this.oidc.exchange(dto.code);
  }
}
```

- [ ] **Step 2: Enregistrer dans AuthModule**

Dans `apps/api/src/core/auth/auth.module.ts` :
- imports : ajouter `CryptoModule` (`import { CryptoModule } from '../crypto/crypto.module';`)
- controllers : ajouter `OidcController`
- providers : ajouter `OidcService`

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter @pulsar/api typecheck`
Expected: exit 0.

```bash
git add apps/api/src/core/auth/
git commit -m "feat(api): OIDC endpoints (config, start, callback, exchange)"
```

---

### Task 6: Étendre le script de rechiffrement à authConfig

**Files:**
- Modify: `apps/api/src/core/crypto/reencrypt.ts`
- Modify: `apps/api/scripts/reencrypt-secrets.ts`
- Test: `apps/api/src/core/crypto/reencrypt.spec.ts` (cas ajouté)

- [ ] **Step 1: Test (échoue)** — ajouter à `reencrypt.spec.ts` :

```ts
import { reencryptAuthConfigs } from './reencrypt';

describe('reencryptAuthConfigs', () => {
  it('re-encrypts the clientSecret inside authConfig', async () => {
    const stored = { enabled: true, issuer: 'https://idp', clientSecret: encryptValue(OLD, 'cs') };
    const updates: { id: string; authConfig: { clientSecret: string } }[] = [];
    const prisma = {
      tenant: {
        findMany: async () => [{ id: 't1', authConfig: stored }],
        update: async ({ where, data }: never) => {
          updates.push({ id: (where as { id: string }).id, ...(data as object) } as never);
        },
      },
    };
    const count = await reencryptAuthConfigs(prisma as never, OLD, NEW);
    expect(count).toBe(1);
    expect(decryptValue(NEW, updates[0].authConfig.clientSecret)).toBe('cs');
  });
});
```

- [ ] **Step 2: Implémenter** — ajouter à `reencrypt.ts` (et retirer la NOTE du plan 6A) :

```ts
/** Re-encrypts Tenant.authConfig.clientSecret (rows without authConfig are skipped). */
export async function reencryptAuthConfigs(
  prisma: PrismaClient,
  oldKey: Buffer | null,
  newKey: Buffer,
): Promise<number> {
  const tenants = await prisma.tenant.findMany({ where: { authConfig: { not: null } } });
  let updated = 0;
  for (const tenant of tenants) {
    const config = tenant.authConfig as { clientSecret?: string } & Record<string, unknown>;
    if (!config.clientSecret) continue;
    let plain: string;
    if (isEncrypted(config.clientSecret)) {
      if (!oldKey) {
        throw new Error(`Tenant ${tenant.id} authConfig is encrypted but ENCRYPTION_KEY_OLD is not set`);
      }
      plain = decryptValue(oldKey, config.clientSecret);
    } else {
      plain = config.clientSecret;
    }
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { authConfig: { ...config, clientSecret: encryptValue(newKey, plain) } },
    });
    updated++;
  }
  return updated;
}
```

Dans `scripts/reencrypt-secrets.ts`, après l'appel intégrations :

```ts
  const authCount = await reencryptAuthConfigs(prisma, oldKey, newKey);
  console.log(`Re-encrypted ${authCount} tenant authConfig(s).`);
```

(et l'import correspondant.)

- [ ] **Step 3: Tests + commit**

Run: `pnpm --filter @pulsar/api test`
Expected: PASS.

```bash
git add apps/api/src/core/crypto/ apps/api/scripts/
git commit -m "feat(api): include tenant authConfig in key rotation script"
```

---

### Task 7: Web — page de complétion, page Settings SSO, lien login

**Files:**
- Create: `apps/web/src/routes/oidc/complete/+page.svelte`
- Create: `apps/web/src/routes/(app)/settings/sso/+page.svelte`
- Modify: `apps/web/src/routes/login/+page.svelte` (emplacement réel à vérifier : `Glob apps/web/src/routes/**/login/**`)

- [ ] **Step 1: Page de complétion (échange du code one-shot)**

`apps/web/src/routes/oidc/complete/+page.svelte` :

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { LoginResponse } from '@pulsar/shared';
  import { setAuth } from '$lib/stores/auth';

  let error = $state('');

  $effect(() => {
    const code = page.url.searchParams.get('code');
    if (!code) {
      error = 'Missing exchange code';
      return;
    }
    void (async () => {
      try {
        const res = await fetch('/api/v1/auth/oidc/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        if (!res.ok) throw new Error('Exchange failed');
        setAuth((await res.json()) as LoginResponse);
        void goto('/dashboard');
      } catch {
        error = 'SSO sign-in failed — the link may have expired. Try again.';
      }
    })();
  });
</script>

{#if error}
  <p class="error-text" style="margin: 64px auto; max-width: 360px;">{error}</p>
{:else}
  <p class="muted" style="margin: 64px auto; max-width: 360px;">Signing you in…</p>
{/if}
```

Note : `$app/state` est l'API Svelte 5 ; si le projet utilise encore `$app/stores` (`import { page } from '$app/stores'` + `$page`), suivre le pattern des pages existantes (vérifier `routes/(app)` avant d'écrire).

- [ ] **Step 2: Page Settings → SSO**

`apps/web/src/routes/(app)/settings/sso/+page.svelte` :

```svelte
<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';

  interface OidcConfigView {
    enabled: boolean;
    issuer: string;
    clientId: string;
    clientSecret: string;
    defaultRoleId: string;
  }
  interface RoleOption {
    id: string;
    name: string;
  }

  let config = $state<OidcConfigView>({
    enabled: false,
    issuer: '',
    clientId: '',
    clientSecret: '',
    defaultRoleId: '',
  });
  let roles = $state<RoleOption[]>([]);
  let error = $state('');

  async function load() {
    try {
      config = await api<OidcConfigView>('/auth/oidc-config');
      roles = await api<RoleOption[]>('/roles');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load SSO config';
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    try {
      config = await api<OidcConfigView>('/auth/oidc-config', { method: 'PUT', body: config });
      toast.success('SSO configuration saved');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save');
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="page-header"><h1>Single sign-on (OIDC)</h1></div>
{#if error}<p class="error-text">{error}</p>{/if}

<form class="card" style="padding: 16px; max-width: 560px;" onsubmit={save}>
  <label style="display: flex; gap: 8px; align-items: center;">
    <input type="checkbox" bind:checked={config.enabled} /> Enable SSO for this organization
  </label>
  <label>Issuer URL <input bind:value={config.issuer} placeholder="https://login.example.com" /></label>
  <label>Client ID <input bind:value={config.clientId} /></label>
  <label>
    Client secret
    <input bind:value={config.clientSecret} placeholder="*** (unchanged if left masked)" />
  </label>
  <label>
    Default role for provisioned users
    <select bind:value={config.defaultRoleId}>
      <option value="" disabled>Choose a role…</option>
      {#each roles as role (role.id)}<option value={role.id}>{role.name}</option>{/each}
    </select>
  </label>
  <button class="btn" type="submit">Save</button>
</form>
```

Note : vérifier la forme de la réponse `GET /roles` (paginée ou non) dans `roles.controller.ts` et adapter (`result.items` si `Paginated<T>`).

- [ ] **Step 3: Lien SSO sur la page de login**

Sur la page de login existante (la localiser via Glob), sous le bouton de connexion, ajouter :

```svelte
{#if tenant}
  <a class="muted" href={`/api/v1/auth/oidc/${tenant}`} style="display: block; margin-top: 12px;">
    Sign in with SSO ({tenant})
  </a>
{/if}
```

(`tenant` = la variable du champ « tenant slug » déjà présente sur le formulaire de login ; si elle a un autre nom, l'utiliser.)

- [ ] **Step 4: Navigation Settings**

Ajouter l'entrée « SSO » à l'endroit où « API keys » et « Users » sont déclarés dans `apps/web/src/routes/(app)/+layout.svelte` (même pattern, gated par la permission `core.tenant.manage` si le layout filtre par permissions — suivre l'existant).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/
git commit -m "feat(web): OIDC complete page, SSO settings, login link"
```

---

### Task 8: E2E OIDC (config + exchange)

Le flow IdP complet n'est pas testable sans IdP ; couvert : CRUD config (masquage), refus d'un code d'échange invalide, 404 sur slug sans SSO.

**Files:**
- Create: `apps/api/test/phase6-oidc.e2e-spec.ts`

- [ ] **Step 1: Écrire la suite**

```ts
/**
 * E2E for phase 6 — OIDC: tenant config round-trip with secret masking,
 * exchange-code hygiene, and 404 for tenants without SSO.
 * The full IdP round-trip is covered by unit tests (openid-client mocked).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Phase 6 — OIDC (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let token: string;
  let roleId: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@pulsar.dev', password: 'admin123', tenant: 'acme' })
      .expect(200);
    token = login.body.accessToken;
    const roles = await request(http).get('/api/v1/roles').set(auth()).expect(200);
    roleId = (Array.isArray(roles.body) ? roles.body : roles.body.items)[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('saves the config and masks the secret on read', async () => {
    const saved = await request(http)
      .put('/api/v1/auth/oidc-config')
      .set(auth())
      .send({
        enabled: false,
        issuer: 'https://idp.example.test',
        clientId: 'pulsar-client',
        clientSecret: 'super-secret',
        defaultRoleId: roleId,
      })
      .expect(200);
    expect(saved.body.clientSecret).toBe('***');

    const read = await request(http).get('/api/v1/auth/oidc-config').set(auth()).expect(200);
    expect(read.body.clientSecret).toBe('***');
    expect(read.body.issuer).toBe('https://idp.example.test');
  });

  it('echoing the mask back preserves the stored secret', async () => {
    const saved = await request(http)
      .put('/api/v1/auth/oidc-config')
      .set(auth())
      .send({
        enabled: false,
        issuer: 'https://idp.example.test',
        clientId: 'pulsar-client-2',
        clientSecret: '***',
        defaultRoleId: roleId,
      })
      .expect(200);
    expect(saved.body.clientId).toBe('pulsar-client-2');
  });

  it('rejects a foreign defaultRoleId', async () => {
    await request(http)
      .put('/api/v1/auth/oidc-config')
      .set(auth())
      .send({
        enabled: false,
        issuer: 'https://idp.example.test',
        clientId: 'x',
        clientSecret: 's',
        defaultRoleId: 'not-a-role',
      })
      .expect(400);
  });

  it('start returns 404 when SSO is disabled', async () => {
    await request(http).get('/api/v1/auth/oidc/acme').expect(404);
  });

  it('rejects an invalid exchange code', async () => {
    await request(http)
      .post('/api/v1/auth/oidc/exchange')
      .send({ code: 'bogus' })
      .expect(401);
  });
});
```

Attention : ce test laisse `enabled: false` sur acme — ne jamais l'activer dans la suite, sinon les reruns d'autres suites pourraient être affectés.

- [ ] **Step 2: Lancer**

Run: `pnpm test:e2e`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/phase6-oidc.e2e-spec.ts
git commit -m "test(api): OIDC config and exchange e2e"
```

---

### Task 9: Mettre à jour le spec (déviation cookie → state chiffré)

- [ ] **Step 1: Éditer le spec**

Dans `docs/superpowers/specs/2026-06-10-phase-6-commercial-readiness-design.md`, section 2, remplacer la mention « stockés dans un cookie signé httpOnly de 10 min » par « transportés dans le paramètre `state` chiffré AES-GCM (TTL 10 min, anti-falsification par le tag GCM ; le `nonce` vérifié dans l'ID token lie la réponse à la requête) — décision prise au plan 6C pour éviter une dépendance cookie ».

- [ ] **Step 2: Vérif finale + commit**

```bash
pnpm typecheck && pnpm test && pnpm test:e2e
git add docs/superpowers/specs/2026-06-10-phase-6-commercial-readiness-design.md
git commit -m "docs: spec updated (OIDC state in encrypted state param)"
```
