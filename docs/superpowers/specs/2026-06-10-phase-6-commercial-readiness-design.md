# Phase 6 — Commercial readiness : design

> Validé le 2026-06-10. Périmètre : toute la phase 6 (admin plateforme, SSO OIDC,
> Billing v2, durcissement SOC2, découverte Fleet en doc seulement).
> Révisé le 2026-06-10 suite à l'[audit TMS](../../audit-tms-2026-06-10.md) :
> le volet Billing v2 est réorienté du sell-side vers le **rapprochement de factures
> transporteur** (freight audit buy-side) — voir la décision ci-dessous.

## Décisions structurantes

| Décision | Choix | Pourquoi |
| -------- | ----- | -------- |
| Modèle « platform admin » | Modèle Prisma `PlatformUser` séparé, login dédié | `User.tenantId` est obligatoire avec `@@unique([tenantId, email])` et ~10 relations tenant-scoped ; un modèle disjoint n'impacte aucun guard existant et garde l'isolation intacte |
| Billing v2 : buy-side audit, pas sell-side | Rapprochement facture transporteur vs coût estimé (tolérances, litige, PAID) | L'audit TMS classe le rapprochement comme trou MVP + ROI le plus démontrable (2-5 % des montants) et différenciateur 19.4 ; le sell-side bâtirait sur une tarification encore embryonnaire — reporté après le rating engine v2 |
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

## 3. Billing v2 — rapprochement de factures transporteur (freight audit buy-side)

Principe : le brouillon existant (coûts estimés des loads COMPLETED) est le
« montant attendu ». La phase 6 ajoute la capture de la facture **réellement reçue**
du transporteur et son rapprochement automatique avec tolérances ; écart hors
tolérance → litige ; puis suivi de paiement.

### Données (évolution des modèles existants — pas de nouvelle entité)

- `Invoice` (existant) gagne : `carrierInvoiceNumber String?` (référence de la
  facture du transporteur), `invoicedTotal Decimal?`, `varianceTotal Decimal?`
  (net, pour affichage), `varianceGross Decimal?` (somme des |écarts| ligne —
  c'est elle qui porte la tolérance), `disputeReasonCode DisputeReasonCode?`,
  `disputeNote String?`, `reconciledAt DateTime?`, `paidAt DateTime?`.
- `InvoiceLine` (existant) gagne : `invoicedAmount Decimal?`, `variance Decimal?`.
- Statuts : `InvoiceStatus` passe de `DRAFT → APPROVED` à
  `DRAFT → APPROVED | DISPUTED`, `DISPUTED → APPROVED`, `APPROVED → PAID`
  (enum mis à jour dans `packages/shared` **et** `schema.prisma` (règle 3),
  state machine `invoice.workflow.ts` dans `packages/shared/src/workflows` +
  tests vitest (règle 2) — les transitions existantes restent valides).
- Nouvel enum `DisputeReasonCode` (shared + Prisma, règle 3) : `RATE_MISMATCH`,
  `QUANTITY_MISMATCH`, `UNEXPECTED_CHARGE`, `DUPLICATE_BILLING`, `OTHER` —
  motifs codifiés pour permettre plus tard les statistiques d'écarts par
  transporteur ; le détail libre va dans `disputeNote`.
- Tolérances : `TenantModule.settings` du module billing —
  `{ tolerancePct: number, toleranceAbsolute: number }` (défauts : 2 % et 25,
  dans la devise de la facture), lues via le module registry, modifiables par
  `PATCH /api/v1/modules/billing` (mécanisme existant).

### Logique

- `POST /billing/invoices/:id/reconcile` (facture en `DRAFT` **ou** `DISPUTED` —
  le re-rapprochement couvre le cas réel le plus fréquent : le transporteur
  renvoie une facture corrigée ; les montants facturés précédents sont écrasés
  et la tolérance réévaluée) — body :
  `{ carrierInvoiceNumber, lines: [{ lineId, invoicedAmount }] }` (toute ligne
  omise = montant attendu). Calcule `variance` par ligne, `varianceTotal` (net)
  et `varianceGross = Σ|variance ligne|`, puis applique la tolérance sur le
  **brut** (le net est borné par le brut, donc un seul test suffit — il attrape
  les écarts de lignes qui se compensent, +100/−100) :
  `varianceGross ≤ max(toleranceAbsolute, invoicedTotal × tolerancePct/100)`
  → transition automatique vers `APPROVED` (« bon à payer ») ; sinon → `DISPUTED`
  avec le détail des écarts par ligne (depuis DISPUTED, rester DISPUTED est un
  no-op d'état, les montants sont mis à jour).
  *Choix documenté* : `max()` sert de plancher aux petites factures (un écart de
  20 sur une facture de 100 ne doit pas partir en litige si le plancher est 25).
  Des clients voudront `min()` (plus strict) — le jour venu c'est un troisième
  paramètre de settings (`toleranceMode`), pas maintenant.
- `POST /billing/invoices/:id/resolve-dispute` — body :
  `{ resolution: 'ACCEPT_INVOICED' | 'KEEP_EXPECTED', reasonCode, note? }`.
  `ACCEPT_INVOICED` : le total payable devient `invoicedTotal` ;
  `KEEP_EXPECTED` : on paie le montant attendu (le transporteur émet un avoir —
  hors système). Les deux mènent à `APPROVED` ; `disputeReasonCode`/`disputeNote`
  conservés.
- `POST /billing/invoices/:id/approve` (existant) reste possible sans
  rapprochement (paiement sur estimé — self-billing assumé).
- `POST /billing/invoices/:id/mark-paid` — body `{ paidAt? }` (défaut now) ;
  exige `APPROVED`.
- Audit explicite avant/après sur reconcile / resolve-dispute / mark-paid
  (règle 14). Rien ne change aux règles d'éligibilité des loads ni à
  l'anti-double-facturation (`InvoiceLine.loadId @unique`).

### Export

- `GET /billing/invoices/export.csv` — CSV de la liste filtrée (statut,
  transporteur, période) avec attendu/facturé/écart par facture, généré en
  mémoire, `Content-Disposition`. (Le PDF sell-side est reporté avec le sell-side.)

### Permissions & module

Clé ajoutée au catalogue : `billing.invoices.pay` (séparation des tâches
approbation/paiement, utile au récit SOC2). `reconcile`/`resolve-dispute` sous
`billing.invoices.manage` existant. Contrôleur déjà sous
`@RequireModule(MODULE_KEYS.BILLING)`.

### Web

- `/invoices` (existant) : colonnes attendu/facturé/écart + filtre statut
  (DISPUTED visible), export CSV.
- Détail facture : formulaire de rapprochement (n° facture transporteur +
  montants facturés par ligne), affichage des écarts ligne par ligne, actions
  résolution de litige / marquer payée.

### Reporté (après rating engine v2 — phase 7+)

La facturation client (sell-side) initialement spécifiée : elle exige un moteur
de tarification digne de ce nom (lanes, weight breaks, détail persisté — voir
audit §5) pour produire des montants défendables.

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

- Unitaires (vitest, `packages/shared`) : state machine `Invoice` étendue
  (DISPUTED, PAID) + logique de tolérance (fonction pure dans `packages/shared`).
- Unitaires (API) : `CryptoService` (round-trip, compat clair, clé invalide).
- E2E (`apps/api/test/phase6.e2e-spec.ts`, conventions existantes — données à codes
  uniques, rejouable) :
  - Plateforme : login platform admin, création de tenant complet (admin invité
    peut consommer son invitation), suspension → login tenant refusé, token
    plateforme rejeté sur une route tenant et inversement.
  - OIDC : CRUD config (secret masqué), `oidc/exchange` avec code invalide refusé.
    (Le flow IdP complet n'est pas testable en e2e sans IdP ; le service de
    callback est couvert en unitaire avec `openid-client` mocké.)
  - Billing v2 : brouillon → reconcile dans la tolérance → APPROVED auto →
    mark-paid ; **écarts compensés** (+X/−X, net 0) → DISPUTED (le test
    anti-angle-mort) ; reconcile hors tolérance → DISPUTED → **re-reconcile**
    (facture corrigée) → APPROVED ; DISPUTED → resolve-dispute → PAID ;
    export CSV 200.

## Hors périmètre (assumé)

- Refresh tokens pour les sessions plateforme ; impersonation/support tenant.
- SCIM, logout OIDC (RP-initiated), multi-IdP par tenant.
- Facturation client (sell-side) — reportée après le rating engine v2 ; taxes ;
  paiements partiels ; ingestion automatique de factures (EDI 210/PDF — la saisie
  est manuelle en v1, l'ingestion IA est le différenciateur 19.3/19.4 à venir).
- Rechiffrement batch des `Integration.config` existants (lazy seulement,
  script mentionné dans le runbook).
