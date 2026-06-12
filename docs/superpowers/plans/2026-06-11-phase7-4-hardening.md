# Phase 7.4 — Durcissements différés : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter la spec [2026-06-11-phase7-4-hardening-design.md](../specs/2026-06-11-phase7-4-hardening-design.md) : MFA plateforme (TOTP + recovery), throttling login plateforme, décorateur composite `@PlatformController()`, cache `Issuer.discover`, slug dans le state OIDC, anti-injection CSV + transitions conditionnelles (buy-side + génération sell-side transactionnelle).

**Architecture:** Liste fermée de dette sécurité — aucune fonctionnalité produit. Le MFA s'insère dans le flux d'auth plateforme existant (tokens d'étape à scope dédié rejetés par `platform-jwt`) ; le reste est local et mécanique. Branche `phase-7-4` (basée sur `phase-7-3`).

**Tech stack:** NestJS, `otplib` (TOTP RFC 6238), `@nestjs/throttler`, Prisma, jest/supertest.

**Précision spec → plan (testabilité)** : `PLATFORM_MFA_ENFORCED` ne gouverne QUE le sort des comptes **sans** MFA au login (enforced → token d'enrôlement obligatoire ; non-enforced → login normal + enrôlement opt-in via endpoint authentifié). Un compte **avec** MFA actif passe TOUJOURS par l'étape verify, quel que soit le flag — c'est ce qui rend le flux e2e testable sans flipper l'env (défaut dev/CI : false).

---

## Carte des fichiers

| Fichier | Rôle |
| ------- | ---- |
| `packages/database/prisma/schema.prisma` + migration | `PlatformUser`: `totpSecret String?`, `mfaEnabledAt DateTime?`, `recoveryCodes String[]` |
| `apps/api/src/common/decorators/platform-controller.decorator.ts` (+ spec) | Décorateur composite |
| `apps/api/src/core/platform/platform-mfa.service.ts` (+ spec) | Enrôlement/vérif TOTP + recovery |
| `apps/api/src/core/platform/platform-auth.service.ts` / `platform-auth.controller.ts` | Flux login à étapes + endpoints MFA + throttler |
| `apps/api/src/core/platform/platform-jwt.strategy.ts` | Rejet des tokens d'étape |
| `apps/api/src/core/platform/platform-tenants.controller.ts` | Sweep `@PlatformController()` |
| `apps/api/src/core/auth/oidc/oidc.service.ts` (+ specs) | Cache `Issuer.discover` |
| `apps/api/src/core/auth/oidc/oidc-state.ts` (+ spec) | `tenantSlug` dans le state |
| `apps/api/src/common/csv.ts` (+ spec) | `csvSafe()` anti-injection |
| `apps/api/src/modules/billing/invoices.service.ts` | csvSafe à l'export + transitions `updateMany` conditionnelles |
| `apps/api/src/modules/billing/customer-invoices.service.ts` | `createDrafts` transactionnel + P2002→409 |
| `apps/api/test/phase7-4-hardening.e2e-spec.ts` | MFA flow + throttling |
| Docs | Mise à jour finale |

---

### Task 1 : Schéma PlatformUser + migration

**Files:** `packages/database/prisma/schema.prisma`, migration `<ts>_phase7_4_platform_mfa`

- [ ] **Step 1 :** Dans `model PlatformUser`, après `lastLoginAt` :

```prisma
  // MFA (TOTP). totpSecret encrypted at rest (enc:v1, CryptoService); recovery
  // codes are bcrypt-hashed and single-use (consumed codes are removed).
  totpSecret    String?
  mfaEnabledAt  DateTime?
  recoveryCodes String[]  @default([])
```

- [ ] **Step 2 :** `prisma validate` ; migration additive (`--create-only` ou manuelle selon le précédent — 3 ADD COLUMN, aucun piège) ; appliquer ; drift check exit 0 ; `pnpm --filter @pulsar/database build`. Typecheck reste vert (additif).
- [ ] **Step 3 : Commit** — `git add packages/database/prisma` ; message `feat(db): platform user MFA columns (totp secret, recovery codes)`.

---

### Task 2 : Décorateur composite `@PlatformController()` + sweep

**Files:**
- Create: `apps/api/src/common/decorators/platform-controller.decorator.ts` (+ `platform-controller.decorator.spec.ts`)
- Modify: `apps/api/src/core/platform/platform-tenants.controller.ts` (et tout autre contrôleur plateforme utilisant la paire manuelle — grep `PlatformGuard`)

- [ ] **Step 1 : Test (échec)** — `platform-controller.decorator.spec.ts` :

```ts
import { Reflector } from '@nestjs/core';
import { PlatformController } from './platform-controller.decorator';

describe('@PlatformController', () => {
  it('applies both the public metadata and the PlatformGuard', () => {
    @PlatformController()
    class Dummy {}
    const reflector = new Reflector();
    // IS_PUBLIC_KEY: importer la constante réelle du décorateur @Public existant.
    expect(reflector.get('isPublic', Dummy)).toBe(true);
    const guards = Reflect.getMetadata('__guards__', Dummy);
    expect(guards?.some((g: unknown) => (g as { name?: string }).name === 'PlatformGuard')).toBe(true);
  });
});
```
(Lire `apps/api/src/common/decorators/public.decorator.ts` pour la clé de métadonnée réelle (`'isPublic'` ou constante exportée) et ajuster l'assertion.)

- [ ] **Step 2 : Implémenter** :

```ts
import { UseGuards, applyDecorators } from '@nestjs/common';
import { Public } from './public.decorator';
import { PlatformGuard } from '../../core/platform/platform.guard';

/**
 * Composite for platform-plane controllers: bypasses the global tenant
 * JwtAuthGuard (@Public) AND enforces the platform JWT (PlatformGuard) in one
 * decorator — forgetting the second half of the manual pair left routes
 * silently open. Always use this on /platform/** controllers.
 */
export function PlatformController() {
  return applyDecorators(Public(), UseGuards(PlatformGuard));
}
```

- [ ] **Step 3 : Sweep** — `grep -l "UseGuards(PlatformGuard)" apps/api/src` ; remplacer chaque paire `@Public()` + `@UseGuards(PlatformGuard)` par `@PlatformController()` (les imports aussi). NE PAS toucher `platform-auth.controller.ts` (login est public SANS guard — c'est correct).
- [ ] **Step 4 :** `pnpm typecheck && pnpm test` verts ; e2e plateforme inchangés (vérifiés en Task 7). Commit `feat(api): @PlatformController composite decorator — platform routes can no longer be silently open`.

---

### Task 3 : MFA plateforme (TOTP + recovery) — le gros morceau

**Files:**
- Create: `apps/api/src/core/platform/platform-mfa.service.ts` (+ `platform-mfa.service.spec.ts`)
- Modify: `platform-auth.service.ts`, `platform-auth.controller.ts`, `platform-jwt.strategy.ts`, `apps/api/src/core/platform/platform.module.ts`
- Modify: `apps/api/package.json` (+ `otplib`)

- [ ] **Step 1 :** `pnpm --filter @pulsar/api add otplib` (vérifier le nom du package api dans son package.json).

- [ ] **Step 2 : Tests jest d'abord** — `platform-mfa.service.spec.ts` (instancier le service avec des fakes minimaux ; secret TOTP fixe ; `otplib.authenticator.generate(secret)` pour produire un code valide dans le test) :

```ts
import { authenticator } from 'otplib';
import { PlatformMfaService } from './platform-mfa.service';

describe('PlatformMfaService (pure parts)', () => {
  const service = new PlatformMfaService(null as never, null as never);

  it('verifyTotp accepts a current code and rejects garbage', () => {
    const secret = authenticator.generateSecret();
    expect(service.verifyTotp(secret, authenticator.generate(secret))).toBe(true);
    expect(service.verifyTotp(secret, '000000')).toBe(false);
  });

  it('generateRecoveryCodes returns 8 distinct 10-char codes', () => {
    const codes = service.generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{10}$/);
  });
});
```

- [ ] **Step 3 : Service** — `platform-mfa.service.ts` :

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { authenticator } from 'otplib';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PlatformMfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  verifyTotp(secret: string, code: string): boolean {
    // RFC 6238, otplib default window (±1 step) tolerates clock skew.
    return authenticator.verify({ token: code, secret });
  }

  generateRecoveryCodes(): string[] {
    return Array.from({ length: 8 }, () => randomBytes(8).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10).padEnd(10, '0'));
  }

  /** Generates a secret + otpauth URI for the enrollment screen. Nothing persisted yet. */
  beginEnrollment(email: string): { secret: string; otpauthUrl: string } {
    const secret = authenticator.generateSecret();
    return { secret, otpauthUrl: authenticator.keyuri(email, 'Pulsar Platform', secret) };
  }

  /** Activates MFA: stores the encrypted secret + hashed one-time recovery codes. */
  async activate(userId: string, secret: string, firstCode: string): Promise<string[]> {
    if (!this.verifyTotp(secret, firstCode)) {
      throw new UnauthorizedException('Invalid TOTP code');
    }
    const recoveryCodes = this.generateRecoveryCodes();
    const hashed = await Promise.all(recoveryCodes.map((c) => hash(c, 10)));
    await this.prisma.platformUser.update({
      where: { id: userId },
      data: {
        totpSecret: this.crypto.encryptString(secret),
        mfaEnabledAt: new Date(),
        recoveryCodes: hashed,
      },
    });
    return recoveryCodes; // Returned ONCE — never retrievable again.
  }

  /** Second factor check: TOTP first, else recovery code (consumed on use). */
  async verifySecondFactor(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.platformUser.findUnique({ where: { id: userId } });
    if (!user?.totpSecret) return false;
    if (this.verifyTotp(this.crypto.decryptString(user.totpSecret), code)) return true;
    for (let i = 0; i < user.recoveryCodes.length; i++) {
      if (await compare(code, user.recoveryCodes[i])) {
        await this.prisma.platformUser.update({
          where: { id: userId },
          data: { recoveryCodes: user.recoveryCodes.filter((_, j) => j !== i) },
        });
        return true;
      }
    }
    return false;
  }
}
```
(Vérifier que `new PlatformMfaService(null as never, null as never)` n'explose pas pour les méthodes pures testées — elles ne touchent ni prisma ni crypto.)

- [ ] **Step 4 : Flux login** — `platform-auth.service.ts` :

Types de payload d'étape (dans `@pulsar/shared` `types/auth.ts` si les payloads y vivent — lire le fichier ; sinon localement) : `{ sub, email, scope: 'mfa-enroll' | 'mfa-pending' }`, expirations 10 min / 5 min.

`login()` devient :
- credentials invalides → 401 inchangé ;
- compte AVEC MFA (`mfaEnabledAt` non null) → retourne `{ mfaRequired: true, mfaToken: <jwt scope mfa-pending 5m> }` (PAS d'accessToken) ;
- compte SANS MFA et `PLATFORM_MFA_ENFORCED === 'true'` (ConfigService) → `beginEnrollment(email)` et retourne `{ mfaEnrollmentRequired: true, enrollToken: <jwt scope mfa-enroll 10m, embarque secret CHIFFRÉ (crypto.encryptString) dans le payload>, otpauthUrl }` ;
- sinon → comportement actuel (accessToken 12 h).

Nouvelles méthodes :
- `enroll(enrollToken, code)` : vérifie le JWT + scope `mfa-enroll`, déchiffre le secret du payload, `mfa.activate(sub, secret, code)` → retourne `{ recoveryCodes, accessToken }` (login complet immédiat).
- `verifyMfa(mfaToken, code)` : vérifie JWT + scope `mfa-pending`, `mfa.verifySecondFactor(sub, code)` → 401 si faux ; sinon access token 12 h + `lastLoginAt`.
- `enrollStart(userId)` (opt-in, authentifié plateforme) : 400 si MFA déjà actif ; sinon `beginEnrollment` → `{ enrollToken, otpauthUrl }` (même mécanique).

`platform-jwt.strategy.ts` : rejeter explicitement tout payload portant `scope` (`mfa-enroll`/`mfa-pending`) — un token d'étape ne donne JAMAIS accès aux routes plateforme (lire la stratégie et ajouter le check dans `validate`).

- [ ] **Step 5 : Endpoints** — `platform-auth.controller.ts` :

```ts
  @Public()
  @Post('mfa/enroll')
  @HttpCode(200)
  enroll(@Body() dto: MfaEnrollDto) {           // { enrollToken: string, code: string }
    return this.auth.enroll(dto.enrollToken, dto.code);
  }

  @Public()
  @Post('mfa/verify')
  @HttpCode(200)
  verifyMfa(@Body() dto: MfaVerifyDto) {        // { mfaToken: string, code: string }
    return this.auth.verifyMfa(dto.mfaToken, dto.code);
  }
```
+ `POST mfa/enroll-start` protégé par `@PlatformController()` au niveau d'un petit contrôleur dédié OU route séparée gardée (le contrôleur d'auth est public — créer `platform-mfa.controller.ts` décoré `@PlatformController()` avec `enroll-start` lisant `req.user.sub`). DTOs class-validator (`@IsString()` partout, `@Length(6,10)` sur code).

- [ ] **Step 6 : Module** — enregistrer `PlatformMfaService` (+ contrôleur MFA) dans `platform.module.ts`.

- [ ] **Step 7 :** `pnpm typecheck && pnpm test` verts. Commit `feat(api): platform MFA — TOTP enrollment, step tokens, one-shot recovery codes`.

---

### Task 4 : Throttling login plateforme

**Files:** `apps/api/package.json`, `apps/api/src/app.module.ts` (ou platform.module), `platform-auth.controller.ts`

- [ ] **Step 1 :** `pnpm --filter @pulsar/api add @nestjs/throttler`.
- [ ] **Step 2 :** Config minimale SANS guard global (le throttling est ciblé) : dans `platform.module.ts`, `ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }])` ; sur le contrôleur d'auth plateforme : `@UseGuards(ThrottlerGuard)` (sur les routes login/mfa/* — les 3 sont des portes de brute-force). 429 au-delà de 5/min/IP.
- [ ] **Step 3 :** Vérifier qu'aucune autre route n'est throttlée (pas de guard global ajouté). `pnpm typecheck && pnpm test`. Commit `feat(api): throttle platform auth endpoints (5/min/IP)`.

---

### Task 5 : OIDC — cache Issuer.discover + slug dans le state

**Files:** `oidc.service.ts`, `oidc-state.ts` (+ leurs specs)

- [ ] **Step 1 : Tests d'abord** — dans `oidc-state.spec.ts` : packer avec `tenantSlug: 'acme'`, unpacker → slug présent ; unpack d'un state au slug différent de celui attendu → l'appelant doit pouvoir comparer (le test du mismatch vit dans `oidc.service.spec.ts` si le service fait la comparaison — lire les specs existantes et suivre leur style).
- [ ] **Step 2 : State** — `OidcFlowState` gagne `tenantSlug: string` ; `packOidcState` l'embarque ; au callback (`oidc.service.ts`), comparer `state.tenantSlug !== slug` → `UnauthorizedException('OIDC state does not belong to this organization')`.
- [ ] **Step 3 : Cache discover** — dans `oidc.service.ts` :

```ts
  private readonly issuerCache = new Map<string, { issuer: Issuer; fetchedAt: number }>();
  private static readonly ISSUER_TTL_MS = 60 * 60_000;

  private async discoverIssuer(url: string, forceRefresh = false): Promise<Issuer> {
    const cached = this.issuerCache.get(url);
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < OidcService.ISSUER_TTL_MS) {
      return cached.issuer;
    }
    const issuer = await Issuer.discover(url);
    this.issuerCache.set(url, { issuer, fetchedAt: Date.now() });
    return issuer;
  }
```
`clientFor` l'utilise ; sur échec de l'échange de code (callback), retenter UNE fois avec `forceRefresh: true` avant de propager (l'IdP a pu pivoter ses endpoints).
- [ ] **Step 4 :** `pnpm test` (specs OIDC verts, y compris existants), `pnpm typecheck`. Commit `feat(api): OIDC issuer discovery cache (1h TTL) + tenant slug bound into the encrypted state`.

---

### Task 6 : csvSafe + transitions conditionnelles buy-side + createDrafts transactionnel

**Files:**
- Create: `apps/api/src/common/csv.ts` (+ `csv.spec.ts`)
- Modify: `apps/api/src/modules/billing/invoices.service.ts`
- Modify: `apps/api/src/modules/billing/customer-invoices.service.ts`

- [ ] **Step 1 : csvSafe TDD** — `csv.spec.ts` :

```ts
import { csvSafe } from './csv';

describe('csvSafe', () => {
  it('prefixes formula-injection starters with a quote', () => {
    for (const v of ['=cmd|/c calc', '+1', '-1', '@SUM(A1)', '\tx']) {
      expect(csvSafe(v)).toBe(`'${v}`);
    }
  });
  it('leaves ordinary values untouched', () => {
    expect(csvSafe('Carrier énorme, "quoted"')).toBe('Carrier énorme, "quoted"');
    expect(csvSafe('123.45')).toBe('123.45');
  });
});
```

Implémentation `csv.ts` :

```ts
/** Spreadsheet formula-injection guard: Excel executes cells starting with = + - @ or tab. */
export function csvSafe(value: string): string {
  return /^[=+\-@\t]/.test(value) ? `'${value}` : value;
}
```
⚠️ Ne pas préfixer les NOMBRES légitimes : dans l'export, appliquer `csvSafe` UNIQUEMENT aux champs texte libres (noms, numéros de facture externes, codes de litige) — pas aux montants (qui sont des nombres sérialisés ; `-12.50` préfixé casserait les rapports). Dans `invoices.service.exportCsv`, appliquer `csvSafe` aux colonnes `carrier.name` et `carrierInvoiceNumber` AVANT `escape()`.

- [ ] **Step 2 : Transitions buy-side conditionnelles** — dans `invoices.service.ts`, remplacer les read-then-write des MUTATIONS de statut par le pattern `updateMany` conditionnel (comme `CustomerInvoicesService.transition`) :
  - `approve` : `updateMany({ where: { id, tenantId, status: DRAFT }, data: {...} })` + count→400 ;
  - `markPaid` : where status `APPROVED` ;
  - `reconcile`/`resolveDispute` : le statut attendu va dans le `where` du `invoice.update` final (le passer en `updateMany` conditionnel DANS la transaction existante + count check après). Comportement fonctionnel identique (mêmes 400), fenêtre fermée. Les audits/inclusions inchangés (re-`get` pour la réponse).
- [ ] **Step 3 : createDrafts transactionnel** — dans `customer-invoices.service.ts`, envelopper la boucle de création par devise dans UNE `this.prisma.$transaction(async (tx) => {...})` interactive (les `create` utilisent `tx.customerInvoice`), audits APRÈS la transaction ; catcher `Prisma.PrismaClientKnownRequestError` `P2002` → `ConflictException('A concurrent generation already billed one of these orders — retry')`.
- [ ] **Step 4 :** `pnpm typecheck && pnpm test` ; les e2e billing existants doivent rester verts (Task 7 le prouve). Commit `fix(api): CSV formula-injection guard, conditional buy-side invoice transitions, transactional sell-side generation (P2002→409)`.

---

### Task 7 : E2E + non-régression

**Files:** Create `apps/api/test/phase7-4-hardening.e2e-spec.ts`

- [ ] **Step 1 : Suite** (squelette standard ; le login plateforme : `platform@pulsar.dev` / `admin123` — vérifier les credentials seedés dans `phase6-platform.e2e-spec.ts` et réutiliser ; ⚠️ le seed admin n'a PAS de MFA — créer un PlatformUser dédié au test via l'API si possible, sinon via le flux opt-in du compte seedé puis... ATTENTION : activer le MFA sur le compte seedé CASSERAIT les autres suites (phase6-platform) qui se loguent simplement. SOLUTION OBLIGATOIRE : la suite crée son propre PlatformUser de test — vérifier s'il existe un endpoint de création de PlatformUser ; s'il n'y en a pas, créer l'utilisateur directement via Prisma dans le beforeAll du test (import du client db comme certains setups le font, ou via une insertion `app.get(PrismaService)`) avec un mot de passe bcrypt connu, et le supprimer en afterAll) :
  1. **Opt-in enroll** : login (compte de test, sans MFA, non-enforced) → accessToken normal ; `POST mfa/enroll-start` (Bearer) → `{ enrollToken, otpauthUrl }` ; extraire le secret de l'otpauthUrl (`secret=...`) ; `POST mfa/enroll { enrollToken, code: authenticator.generate(secret) }` (importer otplib dans le test) → `{ recoveryCodes: [8], accessToken }`.
  2. **Login à étapes** : re-login → `{ mfaRequired: true, mfaToken }`, PAS d'accessToken ; `POST mfa/verify { mfaToken, code: TOTP }` → accessToken ; une route plateforme répond 200 avec ; le `mfaToken` lui-même sur une route plateforme → 401.
  3. **Recovery one-shot** : re-login → verify avec `recoveryCodes[0]` → OK ; re-login → MÊME code → 401.
  4. **Throttling** : 6 logins consécutifs avec un mauvais mot de passe (email dédié pour ne pas polluer) → le 6ᵉ répond 429.
  5. **CSV** : créer une facture buy-side dont le `carrierInvoiceNumber` reconcilié commence par `=` → `GET export.csv` → la cellule est préfixée `'=`.
- [ ] **Step 2 :** Suite seule puis `pnpm test:e2e` COMPLET — les suites phase6-platform/oidc doivent rester vertes (le MFA du compte de test ne les touche pas ; le throttling : ATTENTION, les autres suites se loguent aussi sur /platform/auth/login — 5/min/IP peut casser phase6-platform si elle fait >5 logins/min. Vérifier ; si conflit, monter la limite à 20/min (l'esprit anti-brute-force est préservé) et documenter l'ajustement.)
- [ ] **Step 3 : Commit** — `test(e2e): phase 7.4 — MFA lifecycle, step tokens, one-shot recovery, throttling, CSV guard`.

---

### Task 8 : Docs + gates finaux

**Files:** `TODO.md`, `ROADMAP.md`, `docs/etat-du-projet.md`, `docs/architecture.md`, `docs/runbooks.md`

- [ ] **Step 1 :** RÈGLE : documenter depuis le code. TODO : cocher les 7 items 7.4 (la liste « durcissements différés » de la phase 6 se coche aussi — c'est elle qu'on solde) ; ROADMAP : ✅ 7.4 + **phase 7 entièrement close** ; etat-du-projet : ligne 7.4, chiffres réels, « Prochaine session » → phase 8 (recommandation : BOL + mode LTL/FTL + moteur d'exceptions — les trous restants sous la ligne MVP de l'audit) ; architecture.md : section MFA plateforme (flux à étapes, scopes de tokens) ; runbooks.md : procédure de perte de MFA (un opérateur DB peut vider `totpSecret`/`mfaEnabledAt`/`recoveryCodes` du compte — le documenter).
- [ ] **Step 2 :** Gates `pnpm typecheck && pnpm build && pnpm test && pnpm test:e2e` → tout vert ou BLOCKED.
- [ ] **Step 3 : Commit** — `docs: phase 7.4 hardening shipped — phase 7 complete; next: phase 8 (BOL, modes, exceptions)`.
