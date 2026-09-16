# Module Accès + Lieux dans le cœur — design

Date : 2026-09-16 · Branche : `access-module-core-locations` (depuis `main` @ 5c985e7)

## 1. Problème

Constaté dans le code (pas seulement la doc) :

1. **Accès.** La chaîne plateforme → tenant → collègues existe (création de tenant avec admin
   invité, page Réglages → Utilisateurs avec invitation 72 h et attribution de rôles). Mais il
   n'y a **aucune UI de rôles** : l'API `/roles` existe, un seul rôle `admin` (système, toutes
   permissions) est seedé. Inviter quelqu'un revient à choisir « admin ou rien ». Il manque
   aussi : renvoi d'invitation, visibilité de l'expiration, réactivation d'un compte désactivé,
   édition d'un utilisateur, protection du dernier administrateur.
2. **Lieux.** Un entrepôt WMS (et un site/spot Yard, une usine Fabrication) est une `Location`.
   Le seul endpoint de création est `transportation/locations`, gardé par
   `@RequireModule(TRANSPORTATION)` + `transportation.master-data.manage`. Un tenant WMS sans TMS,
   ou un magasinier sans droits TMS, **ne peut pas créer d'entrepôt**. L'écran WMS dit « demandez
   à un administrateur » sans lien.
3. **Permissions nouvelles.** Aucune synchronisation au démarrage : une clé ajoutée au catalogue
   n'existe en base qu'après `pnpm db:seed`, et les rôles `admin` des tenants créés par la
   plateforme ne la reçoivent jamais.

Hors périmètre (chantier séparé, documenté seulement) : comptes nommés pour le portail client /
transporteur / chauffeur (aujourd'hui : un lien à jeton par client).

## 2. Décisions

### 2.1 Synchronisation des permissions au démarrage (prérequis)

`PermissionsSyncService` (`core/permissions`, `OnApplicationBootstrap`, best-effort, ne throw
jamais, log en cas d'échec) :

- upsert de chaque `PERMISSION_CATALOG` dans `Permission` (`key` unique) ;
- pour chaque rôle `isSystem=true` et `key='admin'` de chaque tenant : `createMany skipDuplicates`
  des `RolePermission` manquantes (toutes les clés du catalogue).

Idempotent, ~1 requête par tenant. Rend possible l'ajout de `core.locations.*` sans reseed.
`pnpm db:seed` garde son propre upsert (inchangé).

### 2.2 Lieux dans le cœur

- Nouveau module `apps/api/src/core/locations/` (`CoreLocationsModule`) : `LocationsService` (déplacé
  depuis `modules/transportation/locations`, logique inchangée, y compris géocodage best-effort via
  `RoutingService`), DTOs déplacés, contrôleur **`@Controller('locations')`** sans `@RequireModule`,
  permissions **`core.locations.read`** / **`core.locations.manage`** (nouvelles clés catalogue,
  descriptors `core`).
- Le contrôleur `transportation/locations` reste comme **alias** (même service, même gate TMS +
  `transportation.master-data.*`) : 10 e2e et 9 usages web existants continuent de fonctionner.
  `TransportationModule` et `core/connect/imports.service.ts` importent le service depuis le cœur.
- Web : la page `/locations` appelle `/locations` ; les 9 usages `/transportation/locations` du web
  migrent vers `/locations` (les listes déroulantes Yard, lanes, rate-studio, transport-orders,
  sales-orders, LoadMap). Nav : « Lieux » reste dans Transport et s'ajoute dans Réglages →
  Plateforme (perm `core.locations.read`).
- Composant partagé `LocationFormModal.svelte` (`$lib/components/locations/`) extrait de la page
  `/locations` (create/update, type pré-sélectionnable, verrouillable). Utilisé par :
  - la page `/locations` ;
  - l'état vide du WMS (« Créer un entrepôt », type WAREHOUSE verrouillé) + lien « Gérer les
    lieux » ; le sélecteur de site WMS gagne aussi un bouton « + Entrepôt » ;
  - les écrans Yard qui choisissent un site (type verrouillé selon le contexte) ;
  - Fabrication si l'audit (§4) confirme une dépendance équivalente pour les usines (PLANT).
  Le bouton n'apparaît que si l'utilisateur détient `core.locations.manage`.
- Descripteur d'audit `@Audit('location', …)` conservé sur les deux contrôleurs (règle 14).

### 2.3 Module Accès (cœur)

**API**

- `GET /roles/templates` (perm `core.roles.read`) → gabarits résolus pour le tenant (voir 2.4).
- `POST /roles/from-template` `{ templateKey }` (perm `core.roles.manage`) → crée le rôle avec les
  clés résolues côté serveur (jamais celles du client) ; 409 si la `key` existe déjà ; audité.
- `DELETE /roles/:id` : refus 400 si des utilisateurs sont assignés (message clair), en plus du
  refus existant pour un rôle système.
- `POST /users/:id/resend-invitation` (perm `core.users.manage`) : 400 si statut ≠ INVITED ;
  invalide les jetons INVITATION non utilisés (`usedAt=now`), crée un nouveau jeton 72 h, courriel
  via `MailService.queue`, renvoie `{ inviteUrl }` ; audité.
- `POST /users/:id/reactivate` (perm `core.users.manage`) : DISABLED → ACTIVE si `lastLoginAt`
  non nul, sinon → INVITED + nouvelle invitation (même mécanique que ci-dessus) ; audité.
- Projection utilisateur (`userSelect`) : ajoute `invitation: { expiresAt: string, expired: boolean }
  | null` (dernier jeton INVITATION non utilisé). Jamais le hash.
- **Protection du dernier administrateur** (`UsersService`) — 400 explicites :
  - un utilisateur ne peut pas se désactiver lui-même ;
  - impossible de désactiver le dernier utilisateur ACTIVE porteur du rôle système `admin` ;
  - impossible de retirer (PATCH `roleIds`) le rôle système `admin` au dernier admin ACTIVE.
  Les compteurs sont calculés dans une transaction (`updateMany` conditionnel sur le statut pour
  éviter la course).
- Statut du compte : `DELETE /users/:id` continue de désactiver (pas de suppression physique).

**Web**

- Nouvelle page **`/settings/roles`** (nav Réglages → Plateforme, perm `core.roles.read`) :
  - liste : nom, clé, description, nombre d'utilisateurs, badge « Système » ;
  - modal créer/éditer : nom, clé (slug auto depuis le nom à la création, via `slugify` de
    `@pulsar/shared`, modifiable), description, **permissions groupées par module** (catalogue
    `PERMISSION_CATALOG` filtré sur `core` + modules activés du tenant ; une clé déjà attribuée
    hors filtre reste visible, grisée), cases « tout lire / tout gérer » par module ;
  - rôle système : permissions en lecture seule (le backend refuse déjà) ;
  - section « Rôles suggérés » : cartes des gabarits non encore créés (clé absente), bouton
    « Créer ce rôle » → `POST /roles/from-template` ;
  - suppression avec confirmation ; désactivée si des utilisateurs sont assignés.
- Page **`/settings/users`** enrichie : modal d'édition (prénom, nom, rôles), badge Invité avec
  « expire dans … » ou « Invitation expirée », bouton « Renvoyer l'invitation », bouton
  « Réactiver » pour un compte désactivé, filtre par statut, aide « les changements de rôle
  s'appliquent à la prochaine reconnexion (≤ 15 min) » (gotcha JWT connu, non corrigé ici).
- Lien « Rôles » dans le sélecteur de rôles du modal d'invitation quand aucun rôle n'existe hors
  `admin`.

### 2.4 Gabarits de rôles (`@pulsar/shared`, pure data)

`packages/shared/src/role-templates.ts` : `ROLE_TEMPLATES: RoleTemplate[]` où
`RoleTemplate = { key, name, description, module: ModuleKey | null, permissionKeys: PermissionKey[],
readOnlyOfEnabledModules?: true }` + fonction pure
`resolveRoleTemplates(enabledModules: ModuleKey[]): ResolvedRoleTemplate[]` qui :

- exclut les gabarits dont `module` n'est pas activé (`null` = toujours) ;
- pour `readOnlyOfEnabledModules`, calcule toutes les clés du catalogue se terminant par `.read`
  dont le module ∈ `core` ∪ modules activés ;
- ne renvoie que des clés présentes dans `PERMISSION_CATALOG` (filtre défensif).

Gabarits v1 (noms FR affichés) :

| key | module | contenu |
| --- | --- | --- |
| `viewer` | — | lecture seule sur core + modules activés (dynamique) |
| `dispatcher` | transportation | master-data read, orders/planning/execution manage, tracking read+write, rates/accessorials/fuel read, tms analytics read, core.locations read+manage, documents read, operating tasks read+manage, agents chat |
| `billing-clerk` | billing | invoices manage+pay, freight-audit manage, customer-invoices manage+send+pay, payments manage, taxes read, subscriptions read, ledger read, documents read |
| `accountant` | billing | ledger manage, taxes manage, assets manage, payments read, invoices read, customer-invoices read, subscriptions manage |
| `warehouse-operator` | wms | wms manage, core.locations read, documents read |
| `warehouse-manager` | wms | wms manage, core.locations read+manage, documents manage, operating tasks read+manage |
| `yard-operator` | yard | yard manage, core.locations read, tms master-data read |
| `fleet-manager` | fleet | fleet manage, tms master-data read+manage, documents manage |
| `sales-rep` | crm | crm manage, sites read, email read+send, documents read |
| `buyer` | procurement | procurement manage, tms rates read, documents read |
| `production-planner` | manufacturing | manufacturing manage, wms read, core aps read, documents read |

Tests Vitest : chaque clé existe dans le catalogue ; `viewer` ne contient que des `.read` ;
filtrage par modules activés ; clés uniques.

### 2.5 Hard rule à ajouter (CLAUDE.md, n° 50)

Les `Location` sont une **entité du cœur** : création/modification via `core/locations`
(`/locations`, perms `core.locations.*`), jamais via un module métier ; `transportation/locations`
n'est qu'un alias gardé TMS. Tout module qui dépend d'un type de lieu (WAREHOUSE, PLANT, site Yard)
doit offrir un raccourci de création dans son UI (conditionné à `core.locations.manage`) plutôt
que renvoyer vers un administrateur. Les nouvelles clés de permission sont synchronisées au
démarrage (`PermissionsSyncService`) et accordées automatiquement aux rôles système `admin` ;
les gabarits de rôles humains vivent dans `ROLE_TEMPLATES` (`@pulsar/shared`, pure data) et sont
résolus côté serveur (`POST /roles/from-template`). Le dernier administrateur actif d'un tenant
ne peut être ni désactivé ni privé du rôle `admin`.

## 3. Tests

- **Shared (Vitest)** : `role-templates.spec.ts` (voir 2.4).
- **API unit (Jest)** : `users.service.spec.ts` (dernier admin, auto-désactivation, resend,
  reactivate), `permissions-sync.service.spec.ts` (idempotence, jamais throw).
- **API e2e** : `access-module.e2e-spec.ts` — depuis l'admin acme : créer un rôle depuis le gabarit
  `warehouse-operator` (409 au second appel), inviter un utilisateur avec ce rôle, extraire le jeton
  de `inviteUrl`, activer via `auth/reset-password`, se connecter, vérifier : `POST /locations`
  type WAREHOUSE → 201 ; `GET /users` → 403 ; `POST /transportation/locations` → 403 ; resend
  invitation sur un compte ACTIVE → 400 ; désactiver puis réactiver ; tentative de désactivation du
  dernier admin → 400 ; suppression d'un rôle assigné → 400. Nettoyage : rôle et utilisateur
  créés avec suffixe unique (règle des e2e rejouables).
- **Web** : Vitest `navigation.test.ts` étendu (lien Rôles visible avec `core.roles.read`, Lieux
  dans Réglages) ; Playwright `access-roles.spec.ts` (API mockée, motif `fleet-workspace.spec.ts`) :
  page Rôles rend les groupes par module, création depuis gabarit ; état vide WMS montre
  « Créer un entrepôt » avec `core.locations.manage` et pas sans.
- Gates : `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` (suites nouvelles + les 10 suites qui
  utilisent `/transportation/locations`), Playwright ciblé, `git diff --check`.

## 4. Audit des dépendances cachées — constats

`MODULE_CATALOG` ne déclare aucune dépendance inter-modules, mais TOUT le master-data partagé
(`Location`, `Customer`, `Carrier`, `Vehicle`, `Trailer`, `Driver`, `Lane`) n'a qu'un seul point
d'écriture : `transportation/*`, gardé TMS. Constats (fichier:ligne relevés sur `main`) :

| Module | Entité | Sévérité | Couvert ici ? |
| --- | --- | --- | --- |
| WMS | `Location` WAREHOUSE (`/wms/sites` lecture seule ; état vide texte `wms/+page.svelte:169`) | BLOQUANT | **Oui** (§2.2) |
| Yard | `Location` site (`/yard/sites` lecture seule ; `yard/+page.svelte:720` sans lien ; `yard/spots:78`, `appointments:144`, `gate:176` appellent `transportation/locations`) | BLOQUANT | **Oui** (§2.2 : `/locations` + raccourci) |
| Yard | `Carrier`, `Trailer` (formulaires porte/rendez-vous) | BLOQUANT | Non — dette |
| Fabrication | site = `Location` **WAREHOUSE** (`calendars.service.ts:72`, `mrp.service.ts:86`) ; `materials/+page.svelte:57` appelle `/wms/sites` (gardé WMS) | BLOQUANT | **Oui** : `/locations?type=WAREHOUSE` |
| Fabrication | `WmsItem` pour les nomenclatures (seule écriture `wms/items`, gardé WMS) | BLOQUANT sans WMS | Non — dette |
| Fleet | roster = `transportation/{vehicles,trailers,drivers}` ; `/assets` (home Fleet) appelle le TMS sans `.catch` (`assets/+page.svelte:84`) | BLOQUANT | Non — dette (propriétaire d'entité à décider) |
| Achats | `Carrier`, `Lane` (RFP) | BLOQUANT | Non — dette |
| Facturation | `Customer`, `Carrier` (pickers `.catch → []`, vides en silence) | BLOQUANT | Non — dette |
| Portails client/transporteur | UI admin des liens vit dans les pages TMS `customers`/`carriers` | BLOQUANT sans TMS | Non — dette |
| Nav Transport | domaine sans `anyPerms`, liens Partenaires sans `perm` → 403 après clic | UX | Partiel : `perm` sur « Lieux » |
| CRM | `Customer` auto-créé à la conversion ; `Location` 403 géré | OK / UX | — |

Conséquence de design : ce chantier fait des **Lieux** la première entité de master-data du cœur.
L'arc suivant recommandé (« Référentiel partagé ») applique le même patron à `Customer`,
`Carrier`, `Vehicle`, `Trailer`, `Driver` (module cœur `core/master-data`, alias TMS conservés),
puis rend le roster Fleet, les pickers Billing/Procurement et l'admin des portails autonomes.
Ajout dérivé pour ce chantier : `GET /locations?type=WAREHOUSE` (filtre optionnel) pour que
WMS/Yard/Fabrication listent leurs sites sans dépendre de `/wms/sites`.

## 5. Livrables

- Code + tests ci-dessus, sur la branche, commits par tâche.
- `CLAUDE.md` règle 50 ; `docs/etat-du-projet.md` entrée datée ; `TODO.md` : dette portail
  (comptes nommés) + dépendances Fleet→TMS ; `docs/plans/access-module-core-locations.md`
  (contrats, limites, reprise — convention du repo).
