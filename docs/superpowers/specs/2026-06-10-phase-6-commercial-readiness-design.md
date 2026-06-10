# Phase 6 — Commercial readiness : design

> Validé le 2026-06-10. Périmètre : toute la phase 6 (admin plateforme, SSO OIDC,
> Billing v2, durcissement SOC2, découverte Fleet en doc seulement).

## Décisions structurantes

| Décision | Choix | Pourquoi |
| -------- | ----- | -------- |
| Modèle « platform admin » | Modèle Prisma `PlatformUser` séparé, login dédié | `User.tenantId` est obligatoire avec `@@unique([tenantId, email])` et ~10 relations tenant-scoped ; un modèle disjoint n'impacte aucun guard existant et garde l'isolation intacte |
| Pricing factures client | `Rate.customerId` existant + `calculateRateCost` | Le modèle de tarifs de vente existe déjà ; cohérent avec le buy-side |
| Sessions plateforme | Access token 12 h, pas de refresh token en v1 | Plan d'ops interne, re-login acceptable ; évite de dupliquer la machinerie refresh |
| Secrets au repos | AES-256-GCM, préfixe `enc:v1:`, migration lazy | Pas de migration de données risquée ; rechiffrement à la prochaine écriture |

## 1. Plan d'administration plateforme (cross-tenant)

### Données

- Nouveau modèle `PlatformUser` : `id`, `email` (unique global), `passwordHash`,
  `firstName`, `lastName`, `status` (`ACTIVE`/`DISABLED`), `lastLoginAt`, timestamps.
  Table `platform_users`. Aucune relation vers les modèles tenant.
- Seed : un admin plateforme initial `platform@pulsar.dev` / `admin123`
  (surchargeable par `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD`).

### Auth

- `POST /platform/auth/login` → access token JWT signé avec le `JWT_SECRET` existant,
  payload `{ sub, email, platformAdmin: true }`, expiration 12 h. Pas de refresh token.
- Nouvelle stratégie Passport `platform-jwt` + `PlatformGuard` : n'accepte que les
  tokens portant `platformAdmin: true`.
- La stratégie `jwt` existante rejette explicitement les tokens platform
  (payload sans `tenantId` / avec `platformAdmin`) → un token plateforme ne peut
  jamais atteindre une route tenant, et inversement.

### Endpoints (`apps/api/src/core/platform/`)

- `POST /platform/auth/login`
- `GET /platform/tenants` — liste paginée + compteurs (users, modules actifs)
- `GET /platform/tenants/:id` — détail (modules, compteurs)
- `POST /platform/tenants` — body : `slug`, `name`, `modules[]` (clés du catalogue),
  `admin { email, firstName, lastName }`. Transaction :
  1. crée le `Tenant` (statut `ACTIVE`),
  2. crée le rôle `Admin` avec **toutes** les permissions du catalogue (même logique
     que le seed),
  3. crée l'utilisateur admin en statut `INVITED` + `UserActionToken` d'invitation
     72 h (réutilise le flux d'invitation existant, email envoyé, `inviteUrl` retourné),
  4. active les modules demandés (`TenantModule`).
- `POST /platform/tenants/:id/suspend` / `POST /platform/tenants/:id/reactivate` —
  bascule `TenantStatus` ; le login tenant rejette déjà `SUSPENDED` (auth.service.ts).
  La suspension invalide aussi les refresh tokens actifs des utilisateurs du tenant.

### Audit

Les actions plateforme sont journalisées via `AuditLogsService.log()` dans l'audit du
tenant ciblé, `userId: null`, `metadata.platformActor: <email du PlatformUser>`.
(Règle 13 : on n'attribue jamais à un faux `User`.)

### Web

Groupe de routes `(platform)` séparé du groupe `(app)` :
- `/platform/login` — login dédié,
- `/platform/tenants` — liste + création (formulaire slug/nom/modules/admin) +
  suspension/réactivation, affiche l'`inviteUrl` après création.
Stockage de token distinct (`localStorage` clé `pulsar_platform_token`), client API
dédié léger (pas de refresh transparent).

## 2. SSO OIDC par tenant

### Config

- Colonne `authConfig Json?` sur `Tenant` : `{ enabled, issuer, clientId,
  clientSecret (chiffré enc:v1:), defaultRoleId }`.
- `GET /auth/oidc-config` / `PUT /auth/oidc-config` — permission `core.tenant.manage`
  (clé existante) ; le `clientSecret` est masqué en lecture
  (`***` si défini), accepté en écriture.
- Page web Settings → SSO (issuer, clientId, secret, rôle par défaut, toggle).

### Flow (lib `openid-client`)

1. `GET /auth/oidc/:tenantSlug` → 302 vers l'IdP. `state` + `nonce` + PKCE
   (`code_verifier`) stockés dans un cookie signé httpOnly de 10 min.
2. `GET /auth/oidc/:tenantSlug/callback` → vérifie state/nonce, échange le code,
   lit `email` (et `given_name`/`family_name` si présents) de l'ID token.
3. Lookup `User` par `(tenant, email)` ; si absent → **provisioning** : création en
   `ACTIVE`, rôle = `defaultRoleId` de la config, `passwordHash` aléatoire
   inutilisable. Si l'utilisateur existe mais est `DISABLED` → refus.
4. `buildSession(user.id)` (même émission access/refresh que le login classique).
5. Redirect vers `WEB_URL/oidc/complete?code=<one-shot>` — code d'échange
   `UserActionToken` kind `OIDC_EXCHANGE`, TTL 60 s, usage unique.
6. Le SPA appelle `POST /auth/oidc/exchange { code }` → reçoit la `LoginResponse`
   complète. Aucun token dans une URL.

Tenant suspendu ou config `enabled: false` → 404/401 propre. Audit `LOGIN` avec
`metadata.method: 'oidc'` (+ `provisioned: true` au premier login).

## 3. Billing v2 — facturation client (sell-side)

### Données

- `CustomerInvoice` : `id`, `tenantId`, `invoiceNumber` (séquence `CINV-` via
  `SequencesService`), `customerId`, `status`, `currency`, `totalAmount`,
  `approvedAt`, `paidAt`, timestamps. `@@unique([tenantId, invoiceNumber])`.
- `CustomerInvoiceLine` : `customerInvoiceId`, `transportOrderId @unique`
  (empêche la double facturation d'une commande), `description`, `amount`.
- Statuts : `DRAFT → APPROVED → PAID` (+ `CANCELLED` depuis DRAFT), enum
  `CustomerInvoiceStatus` dans `packages/shared` **et** `schema.prisma` (règle 3),
  state machine dans `packages/shared/src/workflows` + tests vitest (règle 2).
- Miroir trivial sur le buy-side : ajout de `PAID` à `InvoiceStatus` existant,
  `paidAt` sur `Invoice`, transition `APPROVED → PAID`.

### Logique

- « Facturables » : `GET /billing/customer-invoices/billable?customerId=` →
  commandes du client en statut `COMPLETED` ou `CLOSED` sans ligne de facture, avec montant
  proposé = `calculateRateCost(rate actif du client, distance/poids agrégés des
  shipments de la commande)` ; fallback 0 si pas de tarif actif (montant éditable).
- `POST /billing/customer-invoices` : `customerId` + `orders[{ transportOrderId,
  amount?, description? }]` — montants modifiables tant que `DRAFT`
  (`PATCH /billing/customer-invoices/:id/lines/:lineId`).
- Workflow : `POST :id/approve`, `POST :id/mark-paid` (body `paidAt?`),
  `POST :id/cancel`. Audit explicite avant/après sur chaque transition (règle 14),
  `@Audit` sur create/update.
- `OwnershipService.assertOwned` sur `customerId` et chaque `transportOrderId`
  (règle 9) ; tout filtré `tenantId` (règle 1).

### Export

- `GET /billing/customer-invoices/export.csv` — CSV de la liste filtrée
  (mêmes filtres que la liste), généré en mémoire, `Content-Disposition`.
- `GET /billing/customer-invoices/:id/pdf` — PDF généré à la volée avec `pdfkit`
  et streamé (pas de fichier stocké → `DocumentsService` non concerné).

### Permissions & module

Clés ajoutées au catalogue : `billing.customer-invoice.read`, `.manage`,
`.approve`, `.pay` (alignées sur les clés billing existantes). Contrôleur sous
`@RequireModule(MODULE_KEYS.BILLING)`.

### Web

- `/billing/customer-invoices` (liste + filtres + export CSV),
- `/billing/customer-invoices/[id]` (détail, édition des lignes en DRAFT, approve /
  mark-paid / cancel, bouton PDF),
- création depuis les facturables (sélection client → commandes cochables).
- Bouton « marquer payée » ajouté au détail des factures transporteur.

## 4. Durcissement SOC2-track

- **`CryptoService`** (`apps/api/src/core/crypto/`) : AES-256-GCM, clé 32 octets
  base64 dans `ENCRYPTION_KEY` (ajoutée à `.env.example` ; l'API refuse de démarrer
  sans clé valide). Format : `enc:v1:<iv b64>:<tag b64>:<ciphertext b64>`.
  `encrypt(plaintext)` / `decrypt(value)` — `decrypt` retourne tel quel ce qui ne
  porte pas le préfixe (compat données existantes en clair).
- `Integration.config` : chiffré intégralement à l'écriture (create/update),
  déchiffré en interne (webhooks), **masqué** dans les réponses API (`secret: '***'`).
  Migration lazy : les lignes existantes restent en clair jusqu'à la prochaine
  écriture.
- `Tenant.authConfig.clientSecret` (OIDC) chiffré via le même service.
- `docs/runbooks.md` : rotation `JWT_SECRET` (invalide les sessions, procédure),
  rotation `ENCRYPTION_KEY` (script de rechiffrement à documenter), backup/restore
  PostgreSQL (pg_dump/pg_restore, fréquence, test de restauration).

## 5. Module Fleet — découverte (doc seulement)

`docs/fleet-module-discovery.md` : périmètre proposé (registre d'actifs interne
au-delà de Vehicle/Trailer, maintenance préventive par échéancier, conformité —
immatriculations/inspections/certifications avec dates d'expiration), esquisse de
modèles, clés de permissions pressenties, intégration avec les modèles
Vehicle/Trailer existants, questions ouvertes. **Aucun code.**

## Tests

- Unitaires (vitest, `packages/shared`) : state machine `CustomerInvoice` (+
  transition `PAID` du buy-side).
- Unitaires (API) : `CryptoService` (round-trip, compat clair, clé invalide).
- E2E (`apps/api/test/phase6.e2e-spec.ts`, conventions existantes — données à codes
  uniques, rejouable) :
  - Plateforme : login platform admin, création de tenant complet (admin invité
    peut consommer son invitation), suspension → login tenant refusé, token
    plateforme rejeté sur une route tenant et inversement.
  - OIDC : CRUD config (secret masqué), `oidc/exchange` avec code invalide refusé.
    (Le flow IdP complet n'est pas testable en e2e sans IdP ; le service de
    callback est couvert en unitaire avec `openid-client` mocké.)
  - Billing v2 : billable → création facture → approve → mark-paid → double
    facturation de la même commande refusée → export CSV 200.

## Hors périmètre (assumé)

- Refresh tokens pour les sessions plateforme ; impersonation/support tenant.
- SCIM, logout OIDC (RP-initiated), multi-IdP par tenant.
- Envoi des factures client par email ; taxes ; paiements partiels.
- Rechiffrement batch des `Integration.config` existants (lazy seulement,
  script mentionné dans le runbook).
