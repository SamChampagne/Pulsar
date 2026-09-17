# Comptes portail client + fil « Quoi de neuf » — design

Date : 2026-09-16 · Branche : `access-module-core-locations` (suite de l'arc Accès, à la demande de Sam)
· Base : d9a3821. Sous-chantier 1 (bounded, déjà lancé) : correctif Pages (lien public masqué sur
brouillon + bloc `cta`).

## 1. Problèmes

1. **Portail client sans identité.** Aujourd'hui le portail = un jeton unique par *entreprise cliente*
   (`Customer.portalToken`, lien `/portal/<token>`). Aucun compte nommé, aucun mot de passe, aucun
   droit par personne, commentaires signés du nom de l'entreprise, commandes sans auteur. Impossible
   pour un client d'inviter ses employés ou de révoquer une personne.
2. **Aucune information sur les nouveautés.** Rien n'informe un tenant de ce qui change dans l'app
   (fonctionnalités, corrections). `Notification` est tenant-scopée (pas un fil plateforme).
3. Hors périmètre : refonte CMS du module Pages (il sert seulement de page d'accueil du portail via
   un bloc `cta` vers `/portal/login`).

## 2. Décisions — comptes portail (option A, confirmée par Sam)

### 2.1 Modèle (migration Prisma, enums miroir règle 3)

`packages/shared/src/portal/portal.ts` (pure) : `PortalUserRole { ADMIN, MEMBER }`,
`PortalUserStatus { INVITED, ACTIVE, DISABLED }`, `PortalActionTokenKind { INVITATION, PASSWORD_RESET }`.

```
PortalUser        { id, tenantId, customerId, email, passwordHash, firstName, lastName,
                    role PortalUserRole @default(MEMBER), status PortalUserStatus @default(INVITED),
                    lastLoginAt?, createdAt, updatedAt ; @@unique([tenantId, email]) ;
                    @@index([tenantId, customerId]) ; FK tenant, customer (onDelete Cascade) }
PortalActionToken { id, portalUserId, kind, tokenHash @unique, expiresAt, usedAt?, createdAt }
PortalRefreshToken{ id, portalUserId, tokenHash @unique, expiresAt, revokedAt?, createdAt }
```

Pas de lien vers `User` ni `CrmContact`. `Customer.portalToken` (lien partagé) est **conservé** pour
compatibilité ; il devient un mode dégradé que le tenant peut révoquer.

### 2.2 Troisième plan d'authentification (patron plateforme copié)

- `PortalJwtPayload { sub, tenantId, customerId, email, role, portal: true }` (`@pulsar/shared/types/auth`,
  commentaire « Tenant and platform guards MUST reject it »). Même `JWT_SECRET`, séparation par claim.
- `PortalJwtStrategy` (`'portal-jwt'`) : rejette tout payload sans `portal === true`.
  **`JwtStrategy.validate` et `PlatformJwtStrategy.validate` ajoutent le rejet de `payload.portal`.**
- `PortalGuard extends AuthGuard('portal-jwt')` : à chaque requête relit `PortalUser` (ACTIVE),
  `Customer.isActive`, et re-vérifie l'activation du module CUSTOMER_PORTAL (règle 15) ; pose
  `request.portalUser: PortalAuthUser { id, tenantId, customerId, email, firstName, lastName, role }`.
- Décorateur composite `@PortalController()` = `applyDecorators(Public(), UseGuards(PortalGuard))`
  (même raison que `@PlatformController()`), + `@CurrentPortalUser()`. Spec unitaire du décorateur.
- Auth (`/portal/auth/*`, `@Public()`, `@UseGuards(ThrottlerGuard)` 20/min comme la plateforme) :
  `login { email, password, tenant? }` (slug optionnel ; si l'email existe dans plusieurs tenants
  sans slug → 400 « tenant required »), `refresh`, `logout`, `forgot-password` (toujours `{ok:true}`,
  jeton PASSWORD_RESET 1 h, lien `${WEB_URL}/portal/reset/<token>`), `reset-password`
  (consomme INVITATION ou PASSWORD_RESET ; refuse DISABLED ; active le compte ; révoque les refresh
  tokens), `GET me`. Access token 8 h + refresh 30 j (mêmes durées que le plan tenant). Toute émission
  passe par `issuePortalSession(portalUserId)` (re-gate statut user, customer actif, module actif,
  tenant non suspendu).

### 2.3 API portail authentifiée (`/portal/*`, `@PortalController()`)

`PortalService` est refactoré : chaque méthode publique obtient une variante cœur prenant un
`PortalContext { tenantId, customerId, customerName, tenantName, settings }` ; la variante `token`
résout le contexte via `customerByToken` et délègue (les routes `public/portal/:token` restent
inchangées, tests phase4/phase5 verts). Routes session, mêmes payloads que les routes jeton :
`GET view`, `POST orders`, `GET invoices`, `GET shipments/:id/documents`, `GET documents/:id/download`,
`GET/POST templates`, `DELETE templates/:id`, `POST change-requests`, `GET/POST shipments/:id/comments`.
Attribution : commentaires `authorType 'CUSTOMER'`, `authorId = portalUser.id`,
`authorName = "Prénom Nom · Entreprise"` ; audits `after.portalUserId`. `listTemplates` renvoie
désormais des **codes** de lieux (`originCode`/`destinationCode`) et plus les PK (fuite règle 10 corrigée
sur les deux chemins ; la page jeton web est adaptée).

Gestion des collègues par un portail ADMIN : `GET users`, `POST users` (invite MEMBER ou ADMIN),
`POST users/:id/resend-invitation`, `DELETE users/:id` (désactive ; jamais soi-même ; jamais le
dernier ADMIN actif — garde en transaction Serializable comme le module Accès). MEMBER → 403.

### 2.4 Côté staff du tenant

- Nouvelles permissions `customer-portal.users.read` / `customer-portal.users.manage` (catalogue,
  sync au boot → admin). Ajoutées au gabarit `dispatcher` (read) — les autres gabarits inchangés.
- `PortalUsersAdminController` `@RequireModule(CUSTOMER_PORTAL)` :
  `GET /customer-portal/customers/:customerId/users`, `POST …/users` (invite, 72 h, courriel via
  `MailService.queue`, `inviteUrl` renvoyé), `POST …/users/:id/resend-invitation`,
  `DELETE …/users/:id` (désactive + invalide jetons + révoque refresh), `POST …/users/:id/reactivate`.
  Tout audité (`entityType 'portal-user'`), FK `customerId` via `OwnershipService`.
- Web : carte « Utilisateurs du portail » sur `/customers/[id]` (liste, statut, rôle, inviter,
  renvoyer, désactiver, réactiver ; gated `customer-portal.users.manage`) ; la page détail passe en
  français au passage. Navigation : domaine « Portail client » (module CUSTOMER_PORTAL) avec liens
  « Clients » (`/customers`) et « Image de marque » (ancre sur la carte existante) — ferme le constat
  d'audit « admin des portails uniquement dans les pages TMS ».

### 2.5 Web portail (SvelteKit, sous `/portal`)

- Client `apps/web/src/lib/portal/api.ts` : stockage `pulsar.portal` (access + refresh + user +
  branding), `portalApi<T>(path, opts)` avec refresh automatique et redirection `/portal/login` sur 401.
  Interface `PortalClient { get, post, del, download }` avec deux implémentations : session
  (`/portal/*`) et jeton (`/public/portal/<token>/*`).
- Composants extraits de la page jeton actuelle dans `apps/web/src/lib/portal/` : `OrdersPanel`,
  `InvoicesPanel`, `DocumentsPanel`, `ChangeRequestForm`, `TemplatesPanel`, `CommentsThread`, tous
  paramétrés par `client: PortalClient`. La page `/portal/[token]` devient une coquille qui les
  compose avec le client jeton (comportement identique).
- Routes : `/portal/login`, `/portal/activate/[token]`, `/portal/forgot`, `/portal/reset/[token]`,
  `/portal/(app)/+layout.svelte` (PublicShell + branding + nav : Commandes, Factures, Documents,
  Demandes, Utilisateurs si ADMIN, déconnexion), `/portal/(app)/{orders,invoices,documents,requests,
  users}/+page.svelte`. Routes statiques prioritaires sur `[token]` (SvelteKit).

### 2.6 Sécurité et tests

- Isolation : chaque requête `/portal/*` filtre `tenantId` ET `customerId` du principal ; jamais de
  `customerId` depuis le body.
- Un jeton portail est refusé par toutes les routes tenant (401) et plateforme (401) ; un jeton tenant
  est refusé sur `/portal/*` (401). Testé en e2e.
- e2e `portal-accounts.e2e-spec.ts` : staff invite → activation par lien → login → `GET /portal/view`
  → création de commande (audit `portalUserId`) → commentaire signé → ADMIN invite un MEMBER → MEMBER
  `POST users` 403 → désactivation → login 401 → module désactivé → 403 sur `/portal/view` → croisement
  des jetons (401 ×3) → `reset-password` rejoue un jeton consommé → 401/400.
- Unit : `portal-auth.service.spec` (issuePortalSession gates), `portal-users.service.spec` (dernier
  ADMIN, self), stratégies (rejets croisés), décorateur composite.
- Playwright `portal-accounts.spec.ts` (API mockée) : login → tableau de bord ; MEMBER ne voit pas
  « Utilisateurs ».

## 3. Décisions — fil « Quoi de neuf »

- Modèle plateforme (sans tenantId) : `ReleaseNote { id, title, body, kind ReleaseNoteKind
  (FEATURE|IMPROVEMENT|FIX), version?, status ReleaseNoteStatus (DRAFT|PUBLISHED), publishedAt?,
  createdByEmail, createdAt, updatedAt ; @@index([status, publishedAt]) }`. Enums dans
  `packages/shared/src/release-notes.ts` + miroir Prisma. `UserPreferences.releaseNotesSeenAt DateTime?`
  (nouvelle colonne, même migration).
- Plateforme (`@PlatformController()` `/platform/release-notes`) : `GET`, `POST`, `PATCH /:id`,
  `POST /:id/publish`, `POST /:id/unpublish`, `DELETE /:id` (DRAFT seulement). `createdByEmail =
  req.user.email`.
- Tenant (authentifié, aucune permission requise, `@Controller('release-notes')`) :
  `GET /release-notes` (PUBLISHED, `publishedAt desc`, `Paginated`), `GET /release-notes/unseen-count`
  (`count(publishedAt > releaseNotesSeenAt)`), `POST /release-notes/seen` (met `releaseNotesSeenAt =
  now` via `PreferencesService.update` — DTO + destructuration contrôleur + service étendus).
- Rendu du corps : fonction pure `renderReleaseNoteBody(markdown): string` dans `@pulsar/shared`
  (échappe le HTML, puis `**gras**`, lignes `- ` → `<ul>`, lignes vides → paragraphes ; rien d'autre).
  Testée (XSS `<script>` échappé). Aucune dépendance ajoutée.
- Web plateforme : `/platform/release-notes` (liste, création/édition modal, publier/dépublier,
  supprimer brouillon) + entrée nav dans `platform/+layout.svelte`.
- Web tenant : bouton « Quoi de neuf » (icône Sparkles) à gauche de la cloche avec pastille du nombre
  non lu (chargé avec les notifications, même intervalle) ; page `/whats-new` (chronologie, badges
  FEATURE/IMPROVEMENT/FIX, version) qui appelle `POST /release-notes/seen` à l'ouverture.
- Seed : une note publiée « Bienvenue dans Pulsar » (idempotente sur un id fixe).
- e2e `release-notes.e2e-spec.ts` : plateforme crée un brouillon → tenant n'en voit rien → publie →
  tenant voit 1, unseen 1 → seen → 0 ; tenant `POST /platform/release-notes` → 401 ; jeton
  plateforme sur `GET /release-notes` → 401.

## 4. Hard rules à ajouter (CLAUDE.md)

51. (Portail client — comptes nommés) Le portail client possède son **propre plan d'auth**
    (`PortalUser`, JWT `portal: true`, `PortalJwtStrategy`/`PortalGuard`) : les stratégies tenant et
    plateforme DOIVENT rejeter un jeton portail et réciproquement. Toute route `/portal/**` porte
    `@PortalController()` (jamais `@Public()` seul) ; `PortalGuard` relit le statut du compte, l'état du
    client et l'activation du module CUSTOMER_PORTAL à chaque requête (règle 15). Chaque requête est
    scopée `(tenantId, customerId)` du principal — jamais depuis le body. Le lien partagé
    `Customer.portalToken` reste un mode de compatibilité qui délègue au même `PortalService` via un
    `PortalContext`. Les payloads portail n'exposent que des codes (jamais de PK de `Location`).
    Le dernier ADMIN actif d'un client ne peut être désactivé ; invitations 72 h à usage unique,
    désactivation = jetons invalidés + refresh révoqués.
52. (Quoi de neuf) `ReleaseNote` est une entité **plateforme** (sans tenantId) écrite UNIQUEMENT via
    `/platform/release-notes` (`@PlatformController()`) ; les tenants la lisent en lecture seule
    (`PUBLISHED`). Le corps est rendu par la fonction pure `renderReleaseNoteBody` (`@pulsar/shared`,
    HTML échappé) — jamais de HTML brut, jamais de dépendance Markdown. L'état « vu » est par
    utilisateur (`UserPreferences.releaseNotesSeenAt`), jamais par tenant.

## 5. Livrables

Code + tests ci-dessus ; migrations (1 pour release notes + preferences, 1 pour portail) ; seed ;
CLAUDE.md règles 51-52 ; `docs/etat-du-projet.md` ; `TODO.md` (dette : `TransportOrder.portalUserId`
non persisté — attribution uniquement via audit/commentaires ; throttling absent sur
`public/portal/:token` ; CrmContact ↔ PortalUser non lié ; page jeton à déprécier) ;
`docs/plans/portal-accounts-whats-new.md`.
