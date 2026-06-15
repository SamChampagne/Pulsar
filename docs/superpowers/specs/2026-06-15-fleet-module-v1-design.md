# Fleet Management — Module v1 — Design

> Statut : approuvé (brainstorm 2026-06-15). **Module métier neuf** (pas d'agentique — feature/module
> pur, décidé avec Sam). Suit la recette « Adding a business module » de CLAUDE.md. Premier module de
> l'expansion modulaire post-pivot. Slice v1 = maintenance + conformité (Sam a choisi le périmètre
> « plus gros »).

## Objectif

Donner aux exploitants une vraie gestion de **flotte propre** : suivre l'état des véhicules/remorques,
gérer la **maintenance** (ordres de travail, historique, coût, odomètre, prochaine échéance) et la
**conformité** (documents qui expirent : immatriculation, assurance, inspection, permis/médical). Les
entités d'asset existent déjà (réutilisées du TMS) ; ce module ajoute la couche opérations + une
section UI dédiée.

## Contexte réutilisé (ne pas reconstruire)

- **Assets** (`Vehicle`, `Trailer`, `Driver`) existent dans `schema.prisma`. `Vehicle`/`Trailer` ont
  `status: AssetStatus` (AVAILABLE / IN_SERVICE / MAINTENANCE / RETIRED). `Driver` a `DriverStatus`.
  `carrierId == null` = asset de flotte interne (vs transporteur).
- **CRUD assets** : contrôleurs existants `transportation/{vehicles,trailers,drivers}.controller.ts`
  (gated TRANSPORTATION). PAS de page web. Le roster Fleet les réutilise (pas de duplication).
- `MODULE_KEYS.FLEET = 'fleet'` réservé dans `MODULE_CATALOG` (`available: false` → flip à `true`).
- `DocumentsService` (règle 12) pour les fichiers de conformité ; `AuditLogsService` (règle 6) ;
  `SequencesService` (règle 8) si un numéro de WO est voulu ; `OwnershipService` (règle 9).
- État via machines d'état `@pulsar/shared/workflows` (règle 2) ; enums miroir Prisma (règle 3).

## Décisions verrouillées (brainstorm)

1. **v1 = maintenance + conformité** (périmètre plus gros, choisi par Sam).
2. **2 permissions coarse** : `fleet.read`, `fleet.manage`.
3. **Pas d'entité Schedule récurrente** en v1 — champs `dueDate`/`dueOdometerKm` sur le WO pour
   « prochaine échéance ».
4. **Roster réutilise les endpoints assets existants** (pas de nouveaux endpoints CRUD assets).
5. **Statut de conformité calculé** (jamais stocké).
6. **Sync du statut asset par le workflow de maintenance** (ouvrir WO ⇒ MAINTENANCE, clore ⇒ AVAILABLE).
7. **Aucun agent.**

## Architecture

### A. Activation du module
- `packages/shared/src/modules.ts` : `fleet` → `available: true`.
- `packages/shared/src/permissions.ts` : ajouter `FLEET: { READ: 'fleet.read', MANAGE: 'fleet.manage' }`
  au map + 2 entrées catalogue (récupérées par le seed).
- `apps/api/src/modules/fleet/fleet.module.ts` enregistré dans `app.module.ts` ; tous les contrôleurs
  `@RequireModule(MODULE_KEYS.FLEET)`.
- Web : groupe nav « Fleet » conditionné sur `$auth.tenant.enabledModules.includes(MODULE_KEYS.FLEET)`.
- Activable via `PATCH /modules/fleet` (ou reseed).

### B. Entités (25ᵉ migration)

**`MaintenanceOrder`** (`@@map("maintenance_orders")`) :
`id, tenantId, vehicleId? (FK Vehicle), trailerId? (FK Trailer), type (MaintenanceType:
PREVENTIVE|REPAIR|INSPECTION), status (MaintenanceOrderStatus @default(OPEN)), description,
odometerKm Int?, costAmount Decimal? @db.Decimal(12,2), costCurrency String @default("CAD"),
vendor String?, dueDate DateTime?, dueOdometerKm Int?, openedAt DateTime @default(now()),
completedAt DateTime?, createdById String?, createdAt, updatedAt`. Contrainte applicative : exactement
un de `vehicleId`/`trailerId` non nul (validé en service, pas par la DB). Index `@@index([tenantId, status])`,
`@@index([tenantId, vehicleId])`.

**`ComplianceDocument`** (`@@map("compliance_documents")`) :
`id, tenantId, subjectType (ComplianceSubject: VEHICLE|TRAILER|DRIVER), subjectId String,
docType (ComplianceDocType: REGISTRATION|INSURANCE|INSPECTION|LICENSE|MEDICAL|OTHER), reference String?,
issuedAt DateTime?, expiresAt DateTime, documentId String? (id DocumentsService), notes String?,
createdById String?, createdAt, updatedAt`. Index `@@index([tenantId, subjectType, subjectId])`,
`@@index([tenantId, expiresAt])`. `subjectId` = FK souple (pas de relation Prisma — VEHICLE/TRAILER/DRIVER
polymorphe ; ownership vérifiée en service selon `subjectType`). Back-relations `Tenant` requises pour
les deux modèles ; `MaintenanceOrder` a aussi des relations vers `Vehicle`/`Trailer` (back-relations
ajoutées à ces modèles).

### C. État (`@pulsar/shared/workflows/maintenance.workflow.ts` + compliance helper)
```ts
export enum MaintenanceOrderStatus { OPEN, IN_PROGRESS, COMPLETED, CANCELLED }
export function canTransitionMaintenanceOrder(from, to): boolean
// OPEN→IN_PROGRESS, OPEN→COMPLETED, IN_PROGRESS→COMPLETED, OPEN/IN_PROGRESS→CANCELLED ; from===to no-op
```
```ts
export type ComplianceStatus = 'VALID' | 'EXPIRING' | 'EXPIRED';
export function computeComplianceStatus(expiresAt: string|Date, now: number, warnDays = 30): ComplianceStatus
// expired si expiresAt < now ; expiring si < now+warnDays ; sinon valid. Pur, browser-safe.
```
**Sync asset (règle 2)** : à l'ouverture d'un WO (status OPEN à la création) sur un Vehicle/Trailer,
le service met l'asset en `AssetStatus.MAINTENANCE` (transition gardée). À COMPLETED/CANCELLED, retour
`AVAILABLE`. Audité (règle 6). (Si l'asset n'était pas AVAILABLE — ex. déjà IN_SERVICE sur un load —
le service n'écrase pas brutalement : il ne flippe vers MAINTENANCE que depuis AVAILABLE/IN_SERVICE et
journalise ; détail tranché à l'implémentation, garde-fou : jamais sortir RETIRED.)

### D. Services + API (module Fleet, gated FLEET)
- `MaintenanceService` : CRUD + `start`/`complete`/`cancel` (transitions via `canTransitionMaintenanceOrder`,
  conditional `updateMany` TOCTOU), validation « exactement un asset », sync statut asset, audit.
- `ComplianceService` : CRUD ; `expiring(tenantId, days)` (docs `expiresAt <= now+days`, triés) ;
  ownership du `subjectId` selon `subjectType`. Fichiers via `DocumentsService` (règle 12) si `documentId`.
- `FleetOverviewService` (ou méthode) : `overview(tenantId)` → `{ openWorkOrders, maintenanceDue:
  [vehicles/trailers avec WO dont dueDate<=+Nj ou status OPEN], complianceExpiring: [docs ≤30j],
  complianceExpired: [...] }` — calcul à la lecture.
- Contrôleurs : `/fleet/maintenance-orders` (GET list/?status, GET :id, POST, POST :id/start|complete|cancel),
  `/fleet/compliance-documents` (GET list/?subjectType&subjectId&expiringDays, GET :id, POST, DELETE :id),
  `/fleet/overview` (GET). `fleet.read` sur les GET, `fleet.manage` sur les mutations. Tenant-scopé (règle 1).

### E. Web — section `/fleet`
- **`/fleet`** : dashboard d'attention (cartes : WO ouverts, maintenances dues bientôt, docs expirant
  ≤30 j, docs expirés) via `GET /fleet/overview` + roster des assets propres (réutilise
  `GET /transportation/{vehicles,trailers,drivers}` ; badge statut). Liens vers le détail.
- **`/fleet/vehicles/[id]`** (+ trailers/drivers analogues, ou une page asset générique) : infos asset +
  **historique maintenance** (liste des WO, statut, coût, odomètre) + actions WO (Ouvrir / Démarrer /
  Compléter avec coût+odomètre / Annuler) + **documents de conformité** (liste avec statut coloré
  valid/expiring/expired, ajouter avec docType+expiresAt+upload optionnel, supprimer).
- Nav : nouveau groupe « Fleet » gated FLEET. Pattern web existant (Card/Badge/Button, `api()`, `toast`).
- **DoD** : build + typecheck + **inspection navigateur** (login, activer le module si besoin, ouvrir
  `/fleet`, créer un WO → véhicule passe MAINTENANCE, ajouter un doc expirant → overview, capture).

### F. Règle dure 32 (CLAUDE.md, module Fleet)
> Le statut d'un asset de flotte (`Vehicle`/`Trailer.status: AssetStatus`) ne change via le module Fleet
> QUE par le workflow de maintenance : ouvrir un `MaintenanceOrder` ⇒ asset `MAINTENANCE`,
> COMPLETED/CANCELLED ⇒ `AVAILABLE` (transitions gardées par `canTransitionMaintenanceOrder` +
> garde-fou asset, jamais sortir `RETIRED`, auditées — règles 2/6). Le statut de conformité est
> **calculé** (`computeComplianceStatus`, pur `@pulsar/shared`), jamais persisté. Le roster d'assets
> réutilise les endpoints `transportation/{vehicles,trailers,drivers}` (pas de duplication). Tout endpoint
> Fleet `@RequireModule(MODULE_KEYS.FLEET)` + `fleet.read|manage`, tenant-scopé (règle 1) ; documents via
> `DocumentsService` (règle 12).

## Tests
Unit (`@pulsar/shared`, vitest) : `canTransitionMaintenanceOrder` (valides/invalides) ;
`computeComplianceStatus` (valid/expiring/expired aux bornes exactes).
Unit (API) : `MaintenanceService` ouvre un WO → asset MAINTENANCE ; complete → AVAILABLE + completedAt +
coût ; cancel ; validation « exactement un asset ». `ComplianceService.expiring` filtre par fenêtre.
E2e (DB seedée) : créer WO sur un véhicule → `GET vehicle` montre MAINTENANCE → complete → AVAILABLE ;
créer un compliance doc expirant → `GET /fleet/overview` le liste sous expiring ; isolation tenant
(asset/doc d'un autre tenant invisible/refusé) ; activation module gating (endpoint 403/404 si FLEET off).
+ **vérif navigateur** de `/fleet`.

## Hors périmètre (tranches Fleet suivantes)
Maintenance récurrente planifiée (entité Schedule) · inspections DVIR à checklist · télémétrie/odomètre
automatique · coûts agrégés & analytics flotte · réservation/affectation d'assets aux loads (déjà via
le TMS) · agent de flotte (pas d'agentique pour l'instant).
