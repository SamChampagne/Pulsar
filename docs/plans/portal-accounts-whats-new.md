# Comptes portail client + fil « Quoi de neuf »

Date : 2026-09-17. Branche : `access-module-core-locations` (base `d9a3821`, 18 commits jusqu'à
`0909f1b` inclus ; non mergée). Spec :
`docs/superpowers/specs/2026-09-16-portal-accounts-whats-new-design.md`.

## Résultat métier

Trois lots livrés dans l'ordre (chacun revu et testé avant le suivant) :

1. **Pages fix** — le lien public d'une page « Sites » est masqué tant qu'elle n'est pas publiée ;
   un bloc `cta` (bouton d'appel à l'action) est ajouté, avec un validateur d'URL qui refuse les
   schémas dangereux (`javascript:`), les URLs protocole-relatif (`//host`) et les tentatives
   d'obfuscation par antislash — fermeture d'une brèche d'open-redirect trouvée en revue.
2. **Quoi de neuf** — un flux de notes de version géré par la plateforme et lu en lecture seule par
   les tenants, avec un badge « non vu » par utilisateur.
3. **Comptes portail client** — le portail client (jusqu'ici un lien à jeton unique par client)
   gagne de vrais comptes nommés, avec connexion, invitation, rôle ADMIN/MEMBER et un troisième
   plan d'authentification complet, séparé du plan tenant et du plan plateforme.

## Contrats

Préfixe `/api/v1`, tenant toujours dérivé du JWT (règle 1) sauf le plan portail (dérivé du JWT
portail, voir plus bas).

### Quoi de neuf (règle 52)

- `ReleaseNote` est une entité **plateforme** (pas de `tenantId`). Écriture uniquement via
  `POST/PATCH /platform/release-notes` (`@PlatformController()`, plan d'auth plateforme). Lecture
  tenant : `GET /release-notes` (notes `PUBLISHED` seulement), `GET /release-notes/unseen-count`,
  `POST /release-notes/seen`.
- Le corps est rendu par `renderReleaseNoteBody` (`@pulsar/shared`, pure, HTML échappé) — jamais de
  HTML brut ni de dépendance Markdown.
- L'état « vu » est par **utilisateur** (`UserPreferences.releaseNotesSeenAt`), jamais par tenant :
  deux utilisateurs du même tenant ont chacun leur propre badge.
- Web : `/platform/release-notes` (CRUD plateforme), `/whats-new` (liste tenant), badge Sparkles
  dans la nav globale. Seed idempotent d'une note « Bienvenue dans Pulsar ».

### Comptes portail client (règle 51)

- **Troisième plan d'authentification**, calqué sur le plan plateforme : `PortalUser` (email +
  mot de passe, statut INVITED/ACTIVE/DISABLED, rôle ADMIN/MEMBER par client),
  `PortalActionToken` (invitation/reset, usage unique, 72 h), `PortalRefreshToken`. JWT portail
  porte `portal: true` ; `PortalJwtStrategy`/`PortalGuard` le valident, et les stratégies tenant et
  plateforme **rejettent explicitement** un jeton portail (et réciproquement) — les trois plans ne
  se recoupent jamais.
- Toute route `/portal/**` porte `@PortalController()` (jamais `@Public()` seul). `PortalGuard`
  relit à **chaque requête** : statut du compte, statut du client, activation du module
  CUSTOMER_PORTAL (règle 15 — les routes publiques/portail contournent `ModulesGuard`). La requête
  est scopée `(tenantId, customerId)` du principal JWT, jamais depuis le body.
- Routes : `POST /portal/auth/{login,refresh,logout,forgot-password,reset-password}` ;
  `GET/POST /portal/users` (self-service ADMIN — inviter, désactiver, renvoyer) ; côté staff tenant,
  `customer-portal/customers/:id/users` (perms `customer-portal.users.read|manage`) pour gérer les
  comptes d'un client depuis l'admin TMS.
- `Customer.portalToken` (l'ancien lien à jeton unique) est **conservé** comme mode de
  compatibilité : il délègue au même `PortalService`, désormais recentré sur un `PortalContext`
  commun aux deux entrées (jeton legacy vs session de compte nommé).
- Garde du dernier ADMIN actif : impossible de désactiver le dernier `PortalUser` ADMIN ACTIVE d'un
  client (même patron que la garde dernier-admin plateforme de `access-module-core-locations`).
- Invitation = jeton 72 h à usage unique envoyé par l'outbox (`MailService`, visible du staff —
  volontaire, ce sont des invitations, pas des secrets vivants). Reset de mot de passe = envoi bas
  niveau via `EmailService.send` (jamais l'outbox — c'est un lien vivant, patron copié de
  `core/auth`). Désactivation = invalidation des jetons d'action + révocation des refresh tokens.
- Le mail de réinitialisation utilise le transport SMTP du tenant quand il en a configuré un
  (`EmailConfigService.resolve(user.tenantId)`, injecté depuis `EmailModule` global) et retombe sur
  le transport plateforme sinon.
- Payloads portail : uniquement des **codes** (jamais de PK `Location`) — les gabarits de documents
  et les vues de commande renvoient `originCode`/`destinationCode`, pas d'identifiants internes.

### Web

- `lib/portal/{api,client,session,types}` : client HTTP dédié au plan portail (jeton séparé du
  plan tenant/plateforme dans le navigateur).
- Routes publiques : `/portal/login`, `/portal/forgot`, `/portal/activate/[token]`,
  `/portal/reset/[token]`. Espace authentifié `(app)` : dashboard, commandes, gabarits, documents,
  gestion des collègues (ADMIN).
- Le lien à jeton legacy (`/p/portal/[token]` ou équivalent) reste servi par une page « coquille »
  qui réutilise les mêmes composants — un seul jeu de composants pour les deux entrées.
- Côté staff : carte « Utilisateurs du portail » sur `/customers/[id]` ; domaine de nav
  « Portail client » dédié.

## Invariants

- Les trois plans d'authentification (tenant / plateforme / portail) sont **mutuellement
  exclusifs** : un jeton d'un plan est rejeté par les gardes des deux autres.
- Aucune donnée `tenantId` ni PK interne (`Location`, etc.) ne fuite dans un payload portail —
  projections explicites (règle 10, étendue au portail).
- `ReleaseNote` n'a pas de `tenantId` par construction — c'est une entité plateforme, jamais migrée
  vers un modèle multi-tenant.
- Un `cta.href` de page publique passe toujours par le même validateur que les autres liens de
  bloc — aucun second chemin de validation créé pour le nouveau type de bloc.

## Preuves (gates mesurées le 2026-09-17, DB seedée locale `pulsar_aps`, port API 3100)

| Gate | Commande | Résultat |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | **0 erreur** (shared/database/api/web) ; 12 avertissements a11y web préexistants, hors périmètre |
| Unit | `pnpm test` | **1065 tests** verts (shared 671/74 suites, web 52/7 suites, api 342/64 suites) |
| E2E complet | `pnpm test:e2e` (`--runInBand`, 83 suites) | **782 tests passés / 7 échoués / 1 ignoré** sur 790 ; 79 suites vertes, 1 ignorée (`phase10-osrm-real`, pré-existante), **3 en échec pour cause externe** — moteur APS Python indisponible : `aps-runtime`, `manufacturing-scheduling`, `manufacturing-agent-tools`. `portal-accounts.e2e-spec.ts` et `release-notes.e2e-spec.ts` : **PASS** |
| Playwright | `access-roles`, `whats-new`, `portal-accounts`, `wms-workspace` | **22/22** verts |
| Diff | `git diff --check` | propre |

Détail complet (commandes, sorties, suites en échec) :
`.superpowers/sdd/2026-09-16-portal-accounts-whats-new/task-13-report.md`.

## Limites

- `TransportOrder` n'a pas de colonne `portalUserId` : une action initiée depuis le portail (ex.
  commentaire, document) s'attribue via l'audit/les commentaires, jamais une FK dédiée vers
  `PortalUser`.
- Le lien à jeton (`Customer.portalToken`) reste un mode de compatibilité actif — pas encore
  déprécié.
- Aucun throttling sur `public/portal/:token` (lien de compatibilité) ; `/portal/auth/*`, lui, EST
  throttlé (`ThrottlerGuard` 20 req/min/IP).
- `GET /portal/view` renvoie toute la liste des lieux actifs du shipper (tenant-scopée, pas
  scopée client) — décision produit à prendre (restreindre aux sites du client + hubs publics).
- `CrmContact` et `PortalUser` ne sont pas liés (deux identités séparées pour le même client).
- Détail complet de la dette (mineurs différés en revue, item par item) : section TODO.md
  « Portail client (comptes nommés) & Quoi de neuf — dette 2026-09-17 ».

## Reprise

1. Merger cette branche (PR recommandé, comme pour les arcs précédents).
2. Déprécier progressivement le lien à jeton une fois l'adoption des comptes nommés confirmée.
3. Lier `PortalUser` ↔ `CrmContact` si le pont CRM→portail devient prioritaire.
4. Ajouter une colonne d'attribution portail sur `TransportOrder` (ou équivalent) si la traçabilité
   fine des actions client devient un besoin produit, plutôt que de rester sur audit/commentaires.
5. Dette différée des revues (Tasks 1-12) listée dans TODO.md — rien de bloquant, à traiter au fil
   de l'eau (messages d'erreur, audits before/after, accessibilité `Toasts.svelte`).
