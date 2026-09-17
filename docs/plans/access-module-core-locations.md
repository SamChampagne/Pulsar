# Accès & Lieux cœur

Date : 2026-09-16. Branche : `access-module-core-locations` (base `5c985e7`, dernier commit de code
`2fd87d3` — passe de correction finale ; suivi du seul commit de documentation, non mergée).
Spec : `docs/superpowers/specs/2026-09-16-access-module-core-locations-design.md`.

## Résultat métier

`Location` devient une entité du **cœur** au lieu d'un sous-produit du TMS : un seul point
d'écriture (`core/locations`), synchronisation de permissions au démarrage, et un vrai module
Accès pour gérer rôles/utilisateurs sans jongler entre pages TMS et administration bas niveau.
WMS et Yard cessent de dépendre de `/wms/sites` ou de `transportation/locations` en lecture et
gagnent un raccourci « Créer un entrepôt / + Site » quand l'utilisateur a `core.locations.manage`.

## Contrats API

Préfixe `/api/v1`, tenant toujours dérivé du JWT (règle 1).

- `PermissionsSyncService` (boot) : upsert idempotent du catalogue de permissions
  (`packages/shared/src/permissions.ts`) + attribution automatique des nouvelles clés au rôle
  système `admin` de chaque tenant. Ne throw jamais (best-effort, log seulement).
- `core/locations` : `GET /locations` (`?type=` optionnel — WAREHOUSE/PLANT/…), `POST /locations`,
  `PATCH /locations/:id`. Perms `core.locations.read`/`core.locations.manage`. `@Audit` sur
  create/update. `transportation/locations` reste un alias en lecture/écriture gardé
  `@RequireModule(TMS)` — même service en coulisse, aucune duplication de logique.
- `GET /roles/templates` : gabarits de rôles (`ROLE_TEMPLATES`, `@pulsar/shared`, pure data),
  filtrés par modules activés du tenant via `resolveRoleTemplates`. `POST /roles/from-template`
  crée le rôle (409 si le gabarit existe déjà pour ce tenant). `DELETE /roles/:id` refuse si des
  utilisateurs sont assignés (400).
- `users` : `POST /users/:id/resend-invitation` (400 si le compte n'est plus INVITED),
  `POST /users/:id/reactivate`, projection `invitation` (statut, expiration). Gardes du dernier
  administrateur actif (auto-désactivation, désactivation du dernier admin actif, retrait du rôle
  admin du dernier actif) appliquées dans une transaction Prisma **Serializable** avec claim
  compte+écriture ; `P2034` → 409. La garde ne vise que des cibles **ACTIVE** : un admin INVITED ou
  DISABLED ne compte pas dans le total d'admins actifs, donc il reste révocable même s'il ne reste
  qu'un seul admin ACTIVE dans le tenant. La désactivation invalide les jetons d'invitation/reset
  non utilisés **et révoque les refresh tokens** du compte (même transaction) ;
  `auth/reset-password` rejette un compte `DISABLED`. Les `AuditLogsService.log` explicites
  (users/roles) passent l'acteur par `auditActor()` : un principal `apikey:` laisse la FK à null.
- Gabarits de rôles : le gabarit `viewer` (lecture seule dynamique) **exclut** les lectures
  sensibles de la plateforme (`VIEWER_EXCLUDED_KEYS` de `@pulsar/shared` : `core.audit.read`,
  `core.email.read`, `core.api-keys.read`, `core.users.read`, `core.roles.read`) — un rôle
  « lecture seule » n'ouvre pas la surface de sécurité du tenant. La carte de gabarit de
  `/settings/roles` liste les clés accordées (`<details>`) avant « Créer ce rôle ».

## Web

- `LocationFormModal` (composant partagé) réutilisé par `/locations` (nouvelle page cœur, sous
  Réglages), le raccourci WMS et le raccourci Yard — un seul formulaire de création de lieu.
- Tous les appels web migrés de `transportation/locations` vers `/locations`.
- `/settings/roles` : permissions groupées par module, gabarits suggérés selon les modules
  activés, actions d'écriture gated `core.roles.manage`.
- `/settings/users` : édition, badge d'expiration d'invitation, renvoi, réactivation, filtre.
- Nav : « Rôles » et « Lieux » sous Réglages ; permission sur le lien Transport « Lieux ».

## Preuves (gates mesurées le 2026-09-16, DB seedée locale, port API 3100)

| Gate | Commande | Résultat |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` | **0 erreur** (shared/database/api/web), 12 avertissements a11y préexistants (web, hors périmètre) |
| Unit | `pnpm test` | **962 tests / 134 suites** verts (shared 652/71, web 49/7, api 261/56) |
| E2E **complet** | `pnpm test:e2e` (`--runInBand`, 81 suites) | **751 passés / 7 échoués / 1 ignoré** sur 759 ; 77 suites vertes, 1 ignorée, **3 en échec pour une cause externe** : `aps-runtime`, `manufacturing-scheduling`, `manufacturing-agent-tools` — toutes dépendent du moteur APS Python (HTTP 500 / 503 « APS engine error »), hors périmètre de cette branche. `access-module.e2e-spec.ts` : **PASS** |
| Playwright | `pnpm --filter @pulsar/web exec playwright test e2e/access-roles.spec.ts e2e/wms-workspace.spec.ts e2e/yard-workspace.spec.ts` | **32/32** verts |
| Diff | `git diff --check` | propre |

Le typecheck manufacturing (`scheduling.service.ts`) signalé en dette par une tâche précédente
(Task 1, `.superpowers/sdd/.../progress.md`) n'est **plus reproduit** : 0 erreur observée sur les
quatre workspaces au moment de ce gate.

## Limites

- Comptes portail client/transporteur/chauffeur restent **nommés** — pas de compte utilisateur
  dédié par contact externe (hors périmètre de ce chantier).
- Master-data partagé restant (`Customer`, `Carrier`, `Vehicle`, `Trailer`, `Driver`, `Lane`)
  garde un seul point d'écriture TMS ; Yard (gate/rendez-vous), Fabrication (BOM → `WmsItem`),
  Fleet (`/assets`), Achats (RFP) et Billing (pickers) en dépendent encore sans alias cœur.
- Nav Transport : domaine sans `anyPerms`, liens Partenaires (Clients/Transporteurs) sans `perm`
  — seul « Lieux » a été corrigé dans ce chantier.
- Détail complet des constats non couverts et des minors différés : voir la nouvelle section
  TODO.md « Référentiel partagé & Accès — dette issue de l'audit 2026-09-16 ».

## Reprise

1. Merger cette branche (PR recommandé, comme pour `operational-convergence`).
2. Prochain arc : **`core/master-data`** — même patron que les Lieux appliqué à `Customer`,
   `Carrier`, `Vehicle`, `Trailer`, `Driver`, `Lane` (module cœur + alias TMS conservés), puis
   rendre autonomes le roster Fleet, les pickers Billing/Procurement et l'admin des portails.
3. Migration à surveiller : un rôle personnalisé pré-existant limité à l'ancienne lecture TMS des
   lieux devra recevoir `core.locations.read` à la main (aucun cas réel connu aujourd'hui — seul
   `admin` en dépendait, régénéré automatiquement par `PermissionsSyncService`).
4. Dette différée des revues (Tasks 1-11) listée dans TODO.md — rien de bloquant, à traiter au fil
   de l'eau (messages d'erreur, audits before/after, tooltips, dédup de libellés).
