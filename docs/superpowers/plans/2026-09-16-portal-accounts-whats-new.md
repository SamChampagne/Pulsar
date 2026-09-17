# Comptes portail client + fil « Quoi de neuf » — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au portail client de vrais comptes nommés (invitation, connexion, rôles ADMIN/MEMBER, gestion par le client et par le staff) sur un troisième plan d'authentification, et livrer un fil « Quoi de neuf » rédigé depuis la console plateforme et lu dans l'app.

**Architecture:** (1) Fil « Quoi de neuf » : entité plateforme `ReleaseNote` (sans tenantId), CRUD `@PlatformController()`, lecture tenant `GET /release-notes`, état « vu » par utilisateur dans `UserPreferences.releaseNotesSeenAt`, rendu par une fonction pure de `@pulsar/shared`. (2) Portail : `PortalUser` + jetons dédiés, `PortalJwtStrategy`/`PortalGuard`/`@PortalController()` copiés du plan plateforme ; `PortalService` refactoré autour d'un `PortalContext` pour servir à la fois les routes jeton existantes et les routes session `/portal/*` ; gestion des comptes par le staff (`customer-portal/customers/:id/users`) et par un ADMIN du client (`/portal/users`) ; web portail en composants partagés paramétrés par un `PortalClient`.

**Tech Stack:** NestJS 10 + Passport JWT + Prisma, `@pulsar/shared` (Vitest), SvelteKit SPA Svelte 5, Jest e2e supertest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-16-portal-accounts-whats-new-design.md`

## Global Constraints

- Branche unique `access-module-core-locations` (demande de Sam). Base de ce plan : 05fba10.
- Tenant isolation (règle 1) : routes `/portal/*` filtrent `tenantId` ET `customerId` du principal, jamais depuis le body.
- Enums dans `@pulsar/shared` mirroirs de `schema.prisma`, noms identiques (règle 3) ; `pnpm db:generate` + migration ; rebuild shared/database après modification (règle 7). Apps importent Prisma via `@pulsar/database` (règle 4).
- Routes portail : TOUJOURS `@PortalController()` (jamais `@Public()` seul). Routes plateforme : `@PlatformController()`. Nouveaux endpoints tenant : `@RequirePermissions` (sauf `release-notes` en lecture, par design : tout utilisateur authentifié) ; contrôleurs du module portail côté staff : `@RequireModule(MODULE_KEYS.CUSTOMER_PORTAL)`.
- Mutations sensibles auditées (règles 6/14). Projections : jamais `passwordHash`/`tokenHash` ; payloads portail : codes de lieux, jamais de PK (règle 10).
- Jetons : `randomBytes(32).toString('base64url')`, stockés sha256 hex ; invitation 72 h ; reset 1 h ; refresh 30 j sha256 ; access 8 h.
- Textes UI FR, composants `$lib/components/ui`, `PublicShell` pour le portail ; pas de nouveau thème ; pas de dépendance Markdown.
- Commits `feat|fix|test|docs(scope): …` + trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Commandes : shared `pnpm --filter @pulsar/shared build && pnpm --filter @pulsar/shared test` ; DB `pnpm db:generate`, `pnpm db:migrate` (racine, BD Docker up), `pnpm db:seed` ; API unit `pnpm --filter @pulsar/api test -- <pattern>` ; e2e `pnpm --filter @pulsar/api test:e2e -- test/<f>.e2e-spec.ts` (API port 3100, admin `admin@pulsar.dev`/`admin123`/`acme`, plateforme `platform@pulsar.dev` — mot de passe dans le seed) ; web `pnpm --filter @pulsar/web typecheck` (baseline 0 erreur / 12 warnings), `pnpm --filter @pulsar/web test`, Playwright `pnpm --filter @pulsar/web exec playwright test e2e/<f>.spec.ts`.
- Migrations nommées `<YYYYMMDDHHMMSS>_<snake_case>` (timestamps réels de `prisma migrate dev`).

---

## Carte des fichiers

| Fichier | Rôle |
| --- | --- |
| `packages/shared/src/release-notes.ts` (+ `.spec.ts`) | enums `ReleaseNoteKind/Status`, `renderReleaseNoteBody` (pur) |
| `packages/shared/src/portal/portal.ts` (+ `.spec.ts`), `src/types/auth.ts` | enums portail, `PortalJwtPayload`, `PortalAuthUser`, `PortalLoginResponse` |
| `packages/shared/src/permissions.ts`, `role-templates.ts` | `CUSTOMER_PORTAL.USERS_READ/MANAGE` |
| `packages/database/prisma/schema.prisma` + 2 migrations + `seed.ts` | `ReleaseNote`, `UserPreferences.releaseNotesSeenAt`, `PortalUser`, `PortalActionToken`, `PortalRefreshToken`, note seedée |
| `apps/api/src/core/release-notes/` (module, platform controller, tenant controller, service, spec) | fil « Quoi de neuf » |
| `apps/api/src/core/preferences/*` | champ `releaseNotesSeenAt` |
| `apps/api/src/core/auth/jwt.strategy.ts`, `core/platform/platform-jwt.strategy.ts` | rejet des jetons portail |
| `apps/api/src/modules/customer-portal/auth/` (`portal-jwt.strategy.ts`, `portal.guard.ts`, `portal-auth.service.ts`, `portal-auth.controller.ts`, specs) | plan d'auth portail |
| `apps/api/src/common/decorators/portal-controller.decorator.ts` (+ spec), `current-portal-user.decorator.ts` | composite + décorateur |
| `apps/api/src/modules/customer-portal/portal.service.ts` | refactor `PortalContext` + variantes session + codes de lieux |
| `apps/api/src/modules/customer-portal/portal-session.controller.ts` | routes `/portal/*` |
| `apps/api/src/modules/customer-portal/portal-users.service.ts` (+ spec), `portal-users.admin.controller.ts`, `portal-users.self.controller.ts` | comptes portail (staff + ADMIN client) |
| `apps/api/test/release-notes.e2e-spec.ts`, `apps/api/test/portal-accounts.e2e-spec.ts` | e2e |
| `apps/web/src/lib/portal/{api.ts, client.ts, components/*.svelte}` | client portail + composants extraits |
| `apps/web/src/routes/portal/{login,forgot,activate/[token],reset/[token]}/+page.svelte`, `routes/portal/(app)/+layout.svelte` + pages, `routes/portal/[token]/+page.svelte` (coquille) | web portail |
| `apps/web/src/routes/(app)/customers/[id]/+page.svelte`, `lib/modules/navigation.ts` (+ test) | carte Utilisateurs du portail, domaine « Portail client » |
| `apps/web/src/routes/platform/release-notes/+page.svelte`, `routes/platform/+layout.svelte` | rédaction plateforme |
| `apps/web/src/routes/(app)/whats-new/+page.svelte`, `routes/(app)/+layout.svelte` | page + bouton Sparkles |
| `apps/web/e2e/portal-accounts.spec.ts`, `apps/web/e2e/whats-new.spec.ts` | Playwright |
| `CLAUDE.md` (règles 51-52), `docs/etat-du-projet.md`, `TODO.md`, `docs/plans/portal-accounts-whats-new.md` | docs |

---

## Partie A — Fil « Quoi de neuf »

### Task 1: Shared release notes (enums + rendu pur) et migration

**Files:** Create `packages/shared/src/release-notes.ts`, `release-notes.spec.ts` ; Modify `packages/shared/src/index.ts` ; Modify `packages/database/prisma/schema.prisma` ; migration `…_release_notes`.

**Interfaces:**
- Produces : `export enum ReleaseNoteKind { FEATURE='FEATURE', IMPROVEMENT='IMPROVEMENT', FIX='FIX' }`, `export enum ReleaseNoteStatus { DRAFT='DRAFT', PUBLISHED='PUBLISHED' }`, `export function renderReleaseNoteBody(body: string): string`.
- Prisma : `model ReleaseNote { id String @id @default(cuid()) title String body String kind ReleaseNoteKind version String? status ReleaseNoteStatus @default(DRAFT) publishedAt DateTime? createdByEmail String createdAt DateTime @default(now()) updatedAt DateTime @updatedAt @@index([status, publishedAt]) @@map("release_notes") }` + enums miroirs (commentaire « Mirrors … (rule 3) ») ; `UserPreferences.releaseNotesSeenAt DateTime?`.

- [ ] **Step 1 (test, échoue)** `release-notes.spec.ts` :
```ts
import { describe, expect, it } from 'vitest';
import { renderReleaseNoteBody } from './release-notes';
describe('renderReleaseNoteBody', () => {
  it('escapes html', () => { expect(renderReleaseNoteBody('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'); });
  it('renders paragraphs, bold and bullets', () => {
    expect(renderReleaseNoteBody('Titre **fort**\n\n- un\n- deux')).toBe('<p>Titre <strong>fort</strong></p><ul><li>un</li><li>deux</li></ul>');
  });
  it('returns empty string for blank input', () => { expect(renderReleaseNoteBody('  \n ')).toBe(''); });
});
```
- [ ] **Step 2 (impl)** : découpe par lignes vides en blocs ; bloc dont toutes les lignes commencent par `- ` → `<ul><li>…</li></ul>` ; sinon `<p>` avec lignes jointes par `<br>` ; échappement `& < > " '` AVANT le remplacement `**x**` → `<strong>x</strong>` (regex non gourmande). Export dans `index.ts`.
- [ ] **Step 3** : schéma + `pnpm db:generate` + `pnpm db:migrate --name release_notes` (depuis la racine ; vérifier que le SQL crée le type enum, la table, l'index, la colonne preferences). `pnpm --filter @pulsar/shared build && pnpm --filter @pulsar/shared test` → vert ; `pnpm --filter @pulsar/database build`.
- [ ] **Step 4** commit `feat(shared,db): release notes enums, pure body renderer and schema`.

### Task 2: API release notes (plateforme + tenant) + preferences + seed

**Files:** Create `apps/api/src/core/release-notes/{release-notes.module.ts, release-notes.service.ts, release-notes.service.spec.ts, platform-release-notes.controller.ts, release-notes.controller.ts, dto/release-note.dto.ts}` ; Modify `apps/api/src/app.module.ts`, `core/preferences/{preferences.controller.ts, preferences.service.ts, dto/desk-layout.dto.ts}`, `packages/database/prisma/seed.ts`.

**Interfaces:**
- `ReleaseNotesService` : `listPublished(query: ListQueryDto): Promise<Paginated<ReleaseNoteView>>` (PUBLISHED, `publishedAt desc`) ; `unseenCount(userId): Promise<{ count: number }>` (count PUBLISHED avec `publishedAt > prefs.releaseNotesSeenAt` ou tous si null) ; `markSeen(userId): Promise<{ seenAt: Date }>` (via `PreferencesService.update(userId, { releaseNotesSeenAt: new Date() })`) ; plateforme : `listAll()`, `create(actorEmail, dto)`, `update(id, dto)`, `publish(id)` (status PUBLISHED, `publishedAt = now` si null), `unpublish(id)`, `remove(id)` (400 si PUBLISHED).
- `ReleaseNoteView = { id, title, body, bodyHtml (renderReleaseNoteBody), kind, version, publishedAt }` (tenant) ; plateforme renvoie aussi `status, createdByEmail, createdAt, updatedAt`.
- Routes plateforme `@PlatformController() @Controller('platform/release-notes')` : `GET /`, `POST /`, `PATCH /:id`, `POST /:id/publish`, `POST /:id/unpublish`, `DELETE /:id` ; `createdByEmail = req.user.email` (motif `platform-tenants.controller.ts`).
- Routes tenant `@Controller('release-notes')` (JWT tenant, aucune permission) : `GET /`, `GET /unseen-count`, `POST /seen` (`@HttpCode(200)`).
- DTO : `CreateReleaseNoteDto { @IsString @MaxLength(160) title; @IsString @MaxLength(8000) body; @IsEnum(ReleaseNoteKind) kind; @IsOptional @IsString @MaxLength(40) version? }`, `UpdateReleaseNoteDto = PartialType`.
- Preferences : `UpdatePreferencesDto.releaseNotesSeenAt?: string (@IsOptional @IsDateString)` ; contrôleur destructure `releaseNotesSeenAt` (converti en Date) ; `PreferencesService.get` renvoie aussi `releaseNotesSeenAt`.
- Seed : upsert `ReleaseNote` id fixe `'release-note-welcome'` PUBLISHED kind FEATURE title « Bienvenue dans Pulsar », body court FR, `createdByEmail: 'platform@pulsar.dev'`.

- [ ] Step 1 tests unitaires (Jest, fakes Prisma) : `unseenCount` null seenAt → compte tous les PUBLISHED ; seenAt → filtre `publishedAt > seenAt` ; `remove` sur PUBLISHED → 400 ; `publish` fixe `publishedAt` une seule fois. RED.
- [ ] Step 2 implémentation + wiring (`ReleaseNotesModule` importe `PreferencesModule` — vérifier que `PreferencesService` est exporté, sinon l'exporter) ; `app.module.ts` ajoute le module.
- [ ] Step 3 : `pnpm --filter @pulsar/api typecheck`, unit vert, `pnpm db:seed` (idempotent, relancer 2×).
- [ ] Step 4 commit `feat(core): release notes authored from the platform console, read by tenants`.

### Task 3: e2e release notes

**Files:** Create `apps/api/test/release-notes.e2e-spec.ts`.
- Bootstrap : login tenant (admin acme) ET login plateforme (`POST /platform/auth/login` — lire `phase6-platform.e2e-spec.ts` pour le mot de passe seedé et la gestion MFA éventuelle ; si MFA est enforced par env, utiliser le même contournement que cette suite).
- Scénario : plateforme `POST /platform/release-notes` (DRAFT, titre unique suffixé) → tenant `GET /release-notes` ne contient pas ce titre → `unseen-count` mémorisé N → publish → tenant voit le titre, `bodyHtml` contient `<strong>` si le body avait `**x**` → `unseen-count` = N+1 → `POST /seen` → 0 → tenant `POST /platform/release-notes` avec jeton tenant → 401 → jeton plateforme sur `GET /release-notes` → 401 → `DELETE` d'une note PUBLISHED → 400 → `unpublish` puis `DELETE` → 200 (nettoyage).
- [ ] Écrire, lancer 2× vert, commit `test(core): e2e for release notes`.

### Task 4: Web — page plateforme, bouton Sparkles, page /whats-new

**Files:** Create `apps/web/src/routes/platform/release-notes/+page.svelte`, `apps/web/src/routes/(app)/whats-new/+page.svelte`, `apps/web/e2e/whats-new.spec.ts` ; Modify `apps/web/src/routes/platform/+layout.svelte` (nav `links` ~l.8-12 : `{ href: '/platform/release-notes', label: 'Nouveautés', icon: Sparkles }`), `apps/web/src/routes/(app)/+layout.svelte` (bouton à gauche de la cloche ~l.397 : icône `Sparkles` de lucide, pastille si `unseenReleaseNotes > 0`, `href="/whats-new"` ; chargement de `GET /release-notes/unseen-count` dans la même boucle que les notifications), `apps/web/src/lib/api/preferences.ts` (type `releaseNotesSeenAt`).

- Page plateforme (motif `platform/tenants/+page.svelte`, `platformApi`) : tableau (titre, type, version, statut, publié le), modal créer/éditer (titre, type `Select`, version, corps `Textarea` avec aide « **gras**, listes avec - »), boutons Publier/Dépublier/Supprimer (brouillon seulement) avec confirmation.
- Page tenant `/whats-new` : `api<Paginated<ReleaseNoteView>>('/release-notes')`, chronologie par date, `Badge` par type (FEATURE ok / IMPROVEMENT info / FIX warn — utiliser les tons existants), version en mono ; `{@html note.bodyHtml}` (déjà échappé côté shared — commenter pourquoi c'est sûr) ; à l'ouverture `POST /release-notes/seen` puis remettre le compteur du layout à 0 (store partagé simple `$lib/stores/release-notes.ts` `unseenReleaseNotes = writable(0)`).
- Playwright `whats-new.spec.ts` (API mockée) : `unseen-count` → 2 → pastille visible ; ouvrir `/whats-new` → 2 notes rendues, `<strong>` présent, `POST /release-notes/seen` émis ; pastille absente ensuite.
- [ ] svelte-check 0 nouveau, Vitest vert, Playwright 2/2, smoke réel (plateforme crée + publie, tenant voit). Commit `feat(web): what's new feed and platform release notes page`.

---

## Partie B — Comptes portail client

### Task 5: Shared portail + permissions + migration

**Files:** Create `packages/shared/src/portal/portal.ts` (+ spec) ; Modify `packages/shared/src/types/auth.ts`, `permissions.ts`, `role-templates.ts` (+ spec), `index.ts` ; `schema.prisma` + migration `…_portal_users`.

**Interfaces:**
- Enums : `PortalUserRole { ADMIN, MEMBER }`, `PortalUserStatus { INVITED, ACTIVE, DISABLED }`, `PortalActionTokenKind { INVITATION, PASSWORD_RESET }`.
- Types : `PortalJwtPayload { sub; tenantId; customerId; email; role: PortalUserRole; portal: true }` (doc : « Tenant and platform guards MUST reject it »), `PortalAuthUser { id; tenantId; customerId; email; firstName; lastName; role }`, `PortalLoginResponse { accessToken; refreshToken; user: PortalAuthUser; customer: { id; name }; shipper: { name }; branding: { logoUrl?; accentColor? } }`.
- Permissions : `CUSTOMER_PORTAL.USERS_READ = 'customer-portal.users.read'`, `USERS_MANAGE = 'customer-portal.users.manage'` + descriptors (`portal(...)`) ; `dispatcher` gagne `USERS_READ`.
- Prisma (voir spec §2.1) : `PortalUser` (relations `tenant`, `customer` onDelete Cascade ; `Customer.portalUsers PortalUser[]`), `PortalActionToken`, `PortalRefreshToken` (relations `portalUser` onDelete Cascade) ; enums miroirs.
- [ ] Vitest (enums exportés ; template dispatcher contient la nouvelle clé ; catalogue unique) → shared build/test ; `pnpm db:generate` ; `pnpm db:migrate --name portal_users` ; database build. Commit `feat(shared,db): portal user model, enums, permissions`.

### Task 6: Plan d'auth portail (stratégie, guard, décorateurs, rejets croisés)

**Files:** Create `apps/api/src/modules/customer-portal/auth/{portal-jwt.strategy.ts, portal.guard.ts, portal-jwt.strategy.spec.ts}`, `apps/api/src/common/decorators/{portal-controller.decorator.ts, portal-controller.decorator.spec.ts, current-portal-user.decorator.ts}` ; Modify `core/auth/jwt.strategy.ts` (+ spec), `core/platform/platform-jwt.strategy.ts` (+ spec si existe, sinon créer), `customer-portal.module.ts` (imports `PassportModule`, `JwtModule` config identique à `auth.module.ts` — factoriser si trivial, sinon dupliquer la config avec commentaire).

**Interfaces:**
- `PortalJwtStrategy extends PassportStrategy(Strategy, 'portal-jwt')` : `validate(payload)` → throw `UnauthorizedException('Not a portal access token')` si `payload.portal !== true` ; renvoie `{ id: sub, tenantId, customerId, email, role }` (prénom/nom complétés par le guard).
- `PortalGuard extends AuthGuard('portal-jwt')` : après `super.canActivate`, relit `portalUser` (`findFirst({ where: { id, tenantId, customerId }, include: { customer: { select: { isActive, name } } } })`) ; 401 si absent / `status !== 'ACTIVE'` / `!customer.isActive` ; 403 `ForbiddenException('The customer portal is not enabled for this shipper')` si module CUSTOMER_PORTAL absent de `TenantModulesCacheService.getEnabledKeys(tenantId)` ; pose `request.portalUser: PortalAuthUser`.
- `@PortalController() = applyDecorators(Public(), UseGuards(PortalGuard))` ; `@CurrentPortalUser()` lit `request.portalUser`.
- `JwtStrategy.validate` : ajouter `|| payload.portal` au rejet ; `PlatformJwtStrategy.validate` : rejeter si `payload.portal`.
- [ ] Specs unitaires : la stratégie portail rejette un payload tenant et plateforme ; la stratégie tenant rejette `{ portal: true, tenantId }` ; la stratégie plateforme rejette `{ portal: true, platformAdmin: false }` ; le décorateur applique bien les deux métadonnées (motif `platform-controller.decorator.spec.ts`). Typecheck. Commit `feat(portal): portal auth plane (strategy, guard, composite decorator) with cross-plane rejection`.

### Task 7: PortalAuthService + PortalUsersService + contrôleurs auth/staff/self

**Files:** Create `apps/api/src/modules/customer-portal/auth/{portal-auth.service.ts, portal-auth.service.spec.ts, portal-auth.controller.ts, dto/portal-auth.dto.ts}`, `apps/api/src/modules/customer-portal/{portal-users.service.ts, portal-users.service.spec.ts, portal-users.admin.controller.ts, portal-users.self.controller.ts, dto/portal-user.dto.ts}` ; Modify `customer-portal.module.ts` (`ThrottlerModule` déjà global ; `AuditLogsModule`, `EmailModule` si non global).

**Interfaces (PortalAuthService):**
- `login({ email, password, tenant? })` : normalise l'email ; si `tenant` → `PortalUser` par `(tenant.slug → tenantId, email)` ; sinon `findMany({ where: { email } })` : 0 → 401 générique ; >1 → 400 `'tenant required'` ; 1 → ok ; bcrypt compare ; `status ACTIVE` sinon 401 ; `issuePortalSession(id)` ; met `lastLoginAt`.
- `issuePortalSession(portalUserId): Promise<PortalLoginResponse>` : relit user+customer+tenant ; refuse si user ≠ ACTIVE, customer inactif, tenant SUSPENDED, module CUSTOMER_PORTAL inactif ; signe `PortalJwtPayload` (8 h) ; refresh `randomBytes(48)` sha256, 30 j dans `PortalRefreshToken` ; branding depuis `Tenant.settings.branding`.
- `refresh(token)`, `logout(token)` (révocation), `requestPasswordReset(email, tenant?)` (toujours `{ ok: true }` ; jeton PASSWORD_RESET 1 h ; lien `${WEB_URL}/portal/reset/<token>` via `MailService.queue(tenantId, …)`), `resetPassword(token, password)` (INVITATION ou PASSWORD_RESET ; `usedAt` null et non expiré sinon 401 ; DISABLED → 400 ; transaction : `usedAt`, `passwordHash`, `status ACTIVE`, révocation des refresh).
- Contrôleur `@ApiTags('portal') @Public() @UseGuards(ThrottlerGuard) @Controller('portal/auth')` : `POST login|refresh|logout|forgot-password|reset-password` (`@HttpCode(200)`), `GET me` avec `@PortalController()` sur cette méthode seule (ou un second contrôleur) renvoyant `PortalAuthUser`.

**Interfaces (PortalUsersService):**
- `listForCustomer(tenantId, customerId)` → projection `{ id, email, firstName, lastName, role, status, lastLoginAt, createdAt, invitation: { expiresAt, expired } | null }` (jamais hash).
- `invite(tenantId, customerId, dto: { email, firstName, lastName, role }, actor: { kind: 'staff'|'portal', id })` : 409 si email déjà dans le tenant ; `OwnershipService.assertOwned('customer', customerId, tenantId)` ; crée INVITED avec hash aléatoire ; `issueInvitation` (72 h, invalide les anciens, courriel FR « Vous êtes invité au portail de <shipper> », lien `${WEB_URL}/portal/activate/<token>`) ; audit `CREATE portal-user` (`userId` = staff id filtré apikey, ou `undefined` + `after.portalUserId` pour un acteur portail) ; renvoie projection + `inviteUrl`.
- `resendInvitation`, `deactivate` (self → 400 ; dernier ADMIN ACTIVE du client → 400 ; transaction Serializable : `updateMany` conditionnel, invalidation `PortalActionToken`, révocation `PortalRefreshToken` ; P2034 → 409), `reactivate` (DISABLED → ACTIVE si `lastLoginAt`, sinon INVITED + nouvelle invitation).
- Contrôleur staff `@RequireModule(CUSTOMER_PORTAL) @Controller('customer-portal/customers/:customerId/users')` : `GET` (`USERS_READ`), `POST` (`USERS_MANAGE`, `@Audit` non utilisé — audit explicite dans le service), `POST :id/resend-invitation`, `DELETE :id`, `POST :id/reactivate` (tous `USERS_MANAGE`).
- Contrôleur self `@PortalController() @Controller('portal/users')` : mêmes verbes sans `reactivate` ; chaque méthode exige `portalUser.role === 'ADMIN'` sinon `ForbiddenException` ; `customerId`/`tenantId` du principal.
- [ ] Specs unitaires (fakes Prisma) : `issuePortalSession` refuse user DISABLED / customer inactif / module inactif ; `login` ambigu sans tenant → 400 ; `deactivate` self → 400, dernier ADMIN → 400, ok sinon (jetons + refresh révoqués) ; `invite` doublon → 409. Typecheck. Commit `feat(portal): portal auth service, portal user lifecycle (staff and customer admin)`.

### Task 8: Refactor PortalService (PortalContext) + routes session + codes de lieux

**Files:** Modify `apps/api/src/modules/customer-portal/portal.service.ts`, `portal.controller.ts` (routes jeton inchangées) ; Create `portal-session.controller.ts`.

- `interface PortalContext { tenantId; customerId; customerName; tenantName; settings: unknown; actor?: { portalUserId; displayName } }`. `customerByToken(token)` → `PortalContext` (actor undefined). `contextFromPortalUser(u: PortalAuthUser)` → charge customer/tenant → `PortalContext` avec `actor`.
- Chaque méthode publique existante `x(token, …)` devient `x(token, …) { return this.xFor(await this.customerByToken(token), …) }` + `xFor(ctx, …)` (logique déplacée). Commentaires signés `authorName = actor ? \`${displayName} · ${customerName}\` : customerName`, `authorId = actor?.portalUserId ?? customerId`. Audits : `after.portalUserId` si actor.
- `listTemplatesFor` renvoie `originCode`/`destinationCode` (jointure `Location.code`) au lieu des PK ; `createOrderFor` accepte `originCode`/`destinationCode` (déjà le cas via `resolveLocationCode`) ; adapter la page web jeton (`portal/[token]/+page.svelte:~374`) à ces noms.
- `PortalSessionController` `@ApiTags('portal') @PortalController() @Controller('portal')` : `GET view`, `POST orders`, `GET invoices`, `GET shipments/:shipmentId/documents`, `GET documents/:documentId/download` (`@Res()` streaming comme la route jeton), `GET/POST templates`, `DELETE templates/:id`, `POST change-requests`, `GET/POST shipments/:shipmentId/comments` — chacun `const ctx = await this.portal.contextFromPortalUser(u)` puis `xFor(ctx, …)`.
- [ ] `pnpm --filter @pulsar/api test:e2e -- test/phase4.e2e-spec.ts test/phase5.e2e-spec.ts` verts (routes jeton) ; typecheck. Commit `refactor(portal): PortalContext shared by token and session routes; session endpoints; location codes in templates`.

### Task 9: e2e portal-accounts

**Files:** Create `apps/api/test/portal-accounts.e2e-spec.ts`.
- Préparation : admin acme active le module `customer-portal` (`PATCH /modules/customer-portal` — voir phase4), crée un `Customer` unique (`POST /transportation/customers`), un lieu WAREHOUSE et un CUSTOMER_SITE (`POST /locations`) rattachés si nécessaire.
- Scénario : staff `POST /customer-portal/customers/:cid/users { email, firstName, lastName, role: 'ADMIN' }` → 201 INVITED + `inviteUrl` → extraire le jeton → `POST /portal/auth/reset-password { token, password }` → 200 → `POST /portal/auth/login { email, password, tenant: 'acme' }` → 200 `accessToken` → `GET /portal/auth/me` → role ADMIN → `GET /portal/view` → 200, `JSON.stringify(body)` ne contient ni `tenantId` ni `passwordHash` → `POST /portal/orders` (codes de lieux) → 201 → `GET /portal/shipments/...` optionnel → ADMIN `POST /portal/users { role: 'MEMBER' }` → 201 → activer + login MEMBER → MEMBER `POST /portal/users` → 403 → MEMBER `GET /portal/view` → 200 → jeton portail sur `GET /users` (tenant) → 401 ; sur `GET /platform/operations` → 401 ; jeton tenant sur `GET /portal/view` → 401 → staff `DELETE …/users/:memberId` → 200 DISABLED → login MEMBER → 401 → rejouer le jeton d'invitation consommé → 401 → ADMIN `DELETE /portal/users/:self` → 400 → module désactivé (`PATCH /modules/customer-portal { enabled: false }`) → `GET /portal/view` → 403 → réactiver le module (autres suites) → `refresh` → 200 nouveau couple → `logout` → `refresh` rejoué → 401.
- [ ] 2 runs verts ; commit `test(portal): e2e for portal accounts, auth plane isolation and lifecycle`.

### Task 10: Web portail — client, composants extraits, coquille jeton

**Files:** Create `apps/web/src/lib/portal/api.ts` (`portalApi`, stockage `pulsar.portal`, refresh sur 401 puis redirection `/portal/login`), `apps/web/src/lib/portal/client.ts` (`PortalClient` + `sessionClient()` + `tokenClient(token)`), `apps/web/src/lib/portal/components/{OrdersPanel,InvoicesPanel,DocumentsPanel,ChangeRequestForm,TemplatesPanel,CommentsThread}.svelte` ; Modify `apps/web/src/routes/portal/[token]/+page.svelte` (coquille : `PublicShell` + tabs + composants avec `tokenClient`).
- Extraction fidèle des sections actuelles (`:425` commandes, `:711` factures, `:753` documents, `:806` demandes ; templates et commentaires inclus) ; les composants reçoivent `client: PortalClient` et `view` ; le téléchargement passe par `client.download(path)` (blob).
- [ ] svelte-check 0 nouveau ; smoke Playwright jetable sur `/portal/<token>` (générer un lien via l'API) : commandes listées, création de commande, factures, changement d'onglet — comportement identique. Commit `refactor(web): portal UI extracted into client-parameterized components`.

### Task 11: Web portail — connexion, activation, espace authentifié

**Files:** Create `apps/web/src/routes/portal/{login,forgot}/+page.svelte`, `portal/activate/[token]/+page.svelte`, `portal/reset/[token]/+page.svelte`, `portal/(app)/+layout.svelte`, `portal/(app)/{orders,invoices,documents,requests,users}/+page.svelte`, `apps/web/e2e/portal-accounts.spec.ts`.
- Login : `PublicShell`, champs Courriel / Mot de passe / Entreprise (slug, optionnel, affiché si l'API renvoie « tenant required ») ; succès → stockage + `goto('/portal/orders')`. Activation/reset : mot de passe + confirmation → `POST /portal/auth/reset-password` → message + lien connexion. Forgot : courriel (+ slug optionnel) → toujours « Si un compte existe… ».
- Layout `(app)` : garde `$effect` → `/portal/login` si pas de session ; `PublicShell brand={branding}` ; nav horizontale Commandes · Factures · Documents · Demandes · (Utilisateurs si ADMIN) · Déconnexion ; charge `GET /portal/view` une fois (store `$lib/portal/session.ts`).
- Pages : composent les composants de la Task 10 avec `sessionClient()`. `users` : tableau (nom, courriel, rôle, statut, invitation), inviter (modal), renvoyer, désactiver (confirmation, jamais soi-même) ; messages d'erreur API affichés.
- Playwright `portal-accounts.spec.ts` (API mockée via `page.route`, pas de login réel) : (1) `/portal/login` → mock 200 → redirigé vers `/portal/orders`, nav affiche « Utilisateurs » pour ADMIN ; (2) session MEMBER (localStorage) → « Utilisateurs » absent, `/portal/users` redirige vers `/portal/orders` ; (3) `/portal/users` ADMIN → « Inviter » émet `POST /portal/users` avec le body attendu.
- [ ] svelte-check 0 nouveau ; Playwright 3/3 ; smoke réel avec le compte créé par l'e2e ou via l'API (staff invite → activer → login → créer une commande). Commit `feat(web): customer portal accounts — login, activation, authenticated workspace, colleague management`.

### Task 12: Web staff — carte « Utilisateurs du portail », nav « Portail client », page détail en français

**Files:** Modify `apps/web/src/routes/(app)/customers/[id]/+page.svelte`, `apps/web/src/lib/modules/navigation.ts` (+ `navigation.test.ts`).
- Carte (colonne gauche après la carte commandes) : visible si module `customer-portal` activé ; liste `GET /customer-portal/customers/:id/users` ; actions gated `customer-portal.users.manage` : Inviter (modal courriel/prénom/nom/rôle), Renvoyer, Désactiver (confirmation), Réactiver ; bandeau « Lien d'invitation » copiable comme la page Utilisateurs ; badge statut/invitation identiques.
- Traduire la page détail en FR (titres, libellés) sans changer la logique.
- Nav : domaine `customer-portal` (`module: MODULE_KEYS.CUSTOMER_PORTAL`, label « Portail client », icône `Users`/`Globe`, `home: '/customers'`, `prefixes: []`) avec section « Clients » : `{ href: '/customers', label: 'Clients & portail', perm: PERMISSIONS.CUSTOMER_PORTAL.LINKS_MANAGE }` ; test Vitest : domaine visible seulement avec le module.
- [ ] svelte-check, Vitest, smoke réel. Commit `feat(web): portal users card on customer detail; customer-portal nav domain`.

### Task 13: Docs, règles 51-52, gates complets

**Files:** `CLAUDE.md` (règles 51 et 52 = spec §4 verbatim), `docs/etat-du-projet.md` (entrée datée en tête : Pages fix + Quoi de neuf + comptes portail, chiffres réels), `TODO.md` (dette spec §5 + mineures différées du registre), `docs/plans/portal-accounts-whats-new.md` (Contrats/Preuves/Limites/Reprise).
- Gates : `pnpm typecheck` ; `pnpm test` ; `pnpm test:e2e` complet (noter les suites APS externes) ; Playwright `access-roles`, `whats-new`, `portal-accounts`, `wms-workspace` ; `git diff --check`.
- [ ] Commit `docs: portal accounts, what's new, rules 51-52, status and debt`.

## Ordre et parallélisme
A : 1 → 2 → 3 ; 4 après 2. B : 5 → 6 → 7 → 8 → 9 ; 10 après 8 ; 11 après 10 ; 12 après 7. 13 en dernier. Un seul implémenteur à la fois sauf paires sans fichier commun (ex. 4 ∥ 5, 9 ∥ 10, 11 ∥ 12).
