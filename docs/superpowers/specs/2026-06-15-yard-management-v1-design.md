# Yard Management — Module v1 — Design

> Statut : approuvé (brainstorm 2026-06-15). **Module métier neuf** (feature pure — aucune agentique).
> Suit la recette « Adding a business module » de CLAUDE.md. 3ᵉ module de l'expansion modulaire post-pivot
> (après Fleet et Light WMS). Travail mené en parallèle d'un autre agent (agents/intégrations/UI dispatch) —
> ce design reste **dans sa propre lane** (nouveau module isolé, aucun contrôleur TMS/dispatch modifié).

## Objectif

Donner un **tableau de cour** opérationnel : savoir quelle remorque/quel camion est où (porte de quai /
place de parc), gérer le **gate** (check-in/out), les **mouvements de cour** (déplacer une remorque d'un
spot à un autre), et les **rendez-vous de quai** planifiés (créneaux entrants/sortants qu'une visite
honore).

## Contexte réutilisé (ne pas reconstruire)

- **Sites** = `Location` (modèle existant) ; un `YardSpot` référence un `locationId`.
- **`Trailer`** (Fleet) : `id, carrierId?, unitNumber, plate?, status`. Une visite peut pointer un trailer
  Fleet (FK optionnelle) OU porter un `trailerRef` texte libre (remorque d'un transporteur non suivie).
- **`Carrier`** (modèle existant) : FK optionnelle sur la visite et le rendez-vous.
- `MODULE_KEYS.YARD = 'yard'` réservé (« Yard Management », `available:false` → flip `true`).
- `SequencesService` (règle 8) pour YV-/DA- ; `OwnershipService` (règle 9) ; `AuditLogsService` (règle 6).
  État via machines d'état `@pulsar/shared/yard` (règle 2) ; enums miroir Prisma (règle 3).

## Décisions verrouillées (brainstorm)

1. **v1 = spots + visites + mouvements + rendez-vous** (les 3 features du catalogue).
2. **Remorque** : `Trailer` Fleet optionnel + `trailerRef` texte libre + `Carrier` optionnel.
3. **2 permissions coarse** : `yard.read`, `yard.manage`.
4. **Occupation dérivée** : un spot est occupé s'il porte une visite active (status non terminal) — jamais
   dénormalisé sur le spot.
5. Aucun agent.

## Architecture

### A. Activation du module
- `packages/shared/src/modules.ts` : `yard` → `available: true`.
- `packages/shared/src/permissions.ts` : `YARD: { READ: 'yard.read', MANAGE: 'yard.manage' }` + 2 entrées
  catalogue (mêmes que Fleet/WMS).
- `apps/api/src/modules/yard/yard.module.ts` enregistré dans `app.module.ts` ; contrôleurs `@RequireModule(MODULE_KEYS.YARD)`.
- Web : groupe nav « Yard » conditionné sur `enabledModules.includes(MODULE_KEYS.YARD)`.

### B. Entités (28ᵉ migration)

**`YardSpot`** (`@@map("yard_spots")`) : `id, tenantId, locationId String (FK Location), code String,
type YardSpotType @default(PARKING), isActive Boolean @default(true), createdAt, updatedAt`. Unique
`@@unique([tenantId, locationId, code])`. Index `@@index([tenantId, locationId])`.

**`YardVisit`** (`@@map("yard_visits")`) : `id, tenantId, visitNumber String (YV-), locationId String
(FK Location), trailerId String? (FK Trailer), trailerRef String?, carrierId String? (FK Carrier),
driverName String?, direction YardDirection @default(OTHER), status YardVisitStatus @default(CHECKED_IN),
spotId String? (FK YardSpot, position courante), appointmentId String? (FK DockAppointment), checkInAt
DateTime @default(now()), checkOutAt DateTime?, notes String?, createdById String?, createdAt, updatedAt`.
Unique `@@unique([tenantId, visitNumber])`. Index `@@index([tenantId, status])`, `@@index([tenantId, spotId])`.

**`YardMove`** (`@@map("yard_moves")`) : journal append-only — `id, tenantId, visitId String (FK YardVisit),
fromSpotId String?, toSpotId String?, movedAt DateTime @default(now()), note String?, createdById String?`.
Index `@@index([tenantId, visitId])`.

**`DockAppointment`** (`@@map("dock_appointments")`) : `id, tenantId, appointmentNumber String (DA-),
locationId String (FK Location), spotId String? (FK YardSpot, une porte DOCK_DOOR — optionnelle au booking),
carrierId String? (FK Carrier), direction YardDirection @default(INBOUND), windowStart DateTime, windowEnd
DateTime, reference String?, status DockAppointmentStatus @default(SCHEDULED), notes String?, createdById
String?, createdAt, updatedAt`. Unique `@@unique([tenantId, appointmentNumber])`. Index
`@@index([tenantId, status])`, `@@index([tenantId, windowStart])`. (La visite porte `appointmentId?` — lien
1-1 logique ; pas de FK inverse obligatoire, projection au besoin.)

Back-relations requises : `Tenant` (les 4) ; `Location` (`yardSpots`, `yardVisits`, `dockAppointments`) ;
`Trailer` (`yardVisits`) ; `Carrier` (`yardVisits`, `dockAppointments`) ; `YardSpot` (`visits`, `appointments`,
`movesFrom`/`movesTo`) ; `YardVisit` (`moves`).

### C. État (`@pulsar/shared/src/yard/yard.workflow.ts`, pur testé)
```ts
export enum YardSpotType { DOCK_DOOR = 'DOCK_DOOR', PARKING = 'PARKING', STAGING = 'STAGING' }
export enum YardDirection { INBOUND = 'INBOUND', OUTBOUND = 'OUTBOUND', OTHER = 'OTHER' }
export enum YardVisitStatus { CHECKED_IN = 'CHECKED_IN', ASSIGNED = 'ASSIGNED', DEPARTED = 'DEPARTED', CANCELLED = 'CANCELLED' }
export enum DockAppointmentStatus { SCHEDULED='SCHEDULED', ARRIVED='ARRIVED', COMPLETED='COMPLETED', CANCELLED='CANCELLED', NO_SHOW='NO_SHOW' }

export function canTransitionYardVisit(from, to): boolean
// CHECKED_IN→ASSIGNED, ASSIGNED→CHECKED_IN (retour en attente), CHECKED_IN→DEPARTED, ASSIGNED→DEPARTED,
// CHECKED_IN/ASSIGNED→CANCELLED ; from===to no-op ; DEPARTED/CANCELLED terminaux

export function canTransitionDockAppointment(from, to): boolean
// SCHEDULED→ARRIVED, ARRIVED→COMPLETED, SCHEDULED→CANCELLED, SCHEDULED→NO_SHOW ; from===to no-op ;
// COMPLETED/CANCELLED/NO_SHOW terminaux

// helper pur : un spot est-il libre ? (à partir des statuts des visites qui le pointent)
export function isSpotOccupied(activeVisitStatuses: YardVisitStatus[]): boolean
// occupé si ≥1 visite au statut CHECKED_IN ou ASSIGNED (en pratique on filtre déjà spotId=spot)
```
Tout pur, browser-safe ; enums miroir `schema.prisma` (règle 3).

### D. Services + API (module Yard, gated `@RequireModule(MODULE_KEYS.YARD)`, tenant-scopé règle 1)
- `SpotsService` : CRUD ; `locationId` doit être une Location du tenant (`findFirst` → 404 sinon). `@Audit`.
- `VisitsService` :
  - `checkIn(tenantId, userId, dto)` : crée la visite (status CHECKED_IN, `visitNumber` via Sequences 'yard-visit'→YV-, `checkInAt` now) ; valide trailerId?/carrierId?/spotId? appartiennent au tenant ; si `appointmentId` fourni → vérifie tenant + passe le rendez-vous `ARRIVED` (transition gardée) et lie `appointmentId`. Si `spotId` fourni au check-in → applique l'affectation (voir `assign`). Audit.
  - private `assignToSpot(tx, tenantId, userId, visit, toSpotId)` : transition gardée vers ASSIGNED ; **vérifie l'occupation** du spot cible (`yardVisit.count where { tenantId, spotId: toSpotId, status: { in: [CHECKED_IN, ASSIGNED] }, id: { not: visit.id } }` → si > 0 `ConflictException('Spot already occupied')`) ; écrit un `YardMove { fromSpotId: visit.spotId, toSpotId }` + maj `visit.spotId`, `status: ASSIGNED` dans la **même transaction**.
  - `assign(tenantId, userId, visitId, toSpotId)` / `move(...)` : charge la visite (non terminale), `$transaction(assignToSpot)`. Audit.
  - `checkOut(tenantId, userId, visitId)` : transition gardée → DEPARTED ; claim `updateMany { id, tenantId, status: { in: [CHECKED_IN, ASSIGNED] } }` ; `checkOutAt` now ; écrit un `YardMove { fromSpotId: visit.spotId, toSpotId: null }` ; **conserve** `spotId` historique ? → met `spotId = null` (le spot est libéré ; la position est dans le journal). Audit.
  - `cancel(...)` : → CANCELLED (claim) ; libère le spot (`spotId=null`) ; audit.
  - `list(tenantId, query)` : filtres status/locationId/spotId ; include trailer/carrier/spot projections.
- `AppointmentsService` : CRUD (windowStart < windowEnd validé) + `arrive`/`complete`/`cancel`/`noShow`
  (transitions gardées + claim `updateMany`). `@Audit`.
- `YardOverviewService` :
  - `overview(tenantId)` : `{ trucksInYard (visites actives), occupiedDoors, freeDoors, visitsWithoutSpot,
    appointmentsToday }` — calcul à la lecture.
  - `board(tenantId, locationId?)` : par site → spots (avec la visite active dérivée occupant chacun) +
    les visites actives sans spot. Lecture.
- Contrôleurs : `/yard/spots`, `/yard/visits` (+ `:id/assign`, `:id/move`, `:id/check-out`, `:id/cancel`),
  `/yard/appointments` (+ `:id/arrive|complete|cancel|no-show`), `/yard/overview`, `/yard/board`.
  `yard.read` sur les GET, `yard.manage` sur les mutations.

### E. Web — section `/yard`
- **`/yard`** : **tableau de cour** — sélecteur de site → grille des spots (DOCK_DOOR / PARKING / STAGING)
  avec badge libre/occupé + la visite occupante (n°, remorque/plaque, carrier, direction) ; **file des
  visites en cour sans spot** (à placer) ; cartes compteurs (camions en cour, portes occupées/libres,
  rendez-vous du jour). Actions in-context : **Affecter** (choisir un spot libre), **Déplacer**, **Check-out**.
- **`/yard/gate`** : workbench gate — formulaire de check-in (trailer Fleet **ou** texte libre, carrier,
  direction, rendez-vous optionnel, spot optionnel) + liste des visites actives avec check-out.
- **`/yard/appointments`** : rendez-vous (liste triée par `windowStart`, badge statut ; créer ; arrive /
  complete / cancel / no-show ; lien vers la visite qui l'honore).
- **`/yard/spots`** : master-data spots (par site, type, actif).
- Nav : groupe **« Yard »** gated YARD. Pattern web existant. **DoD = inspection navigateur** (créer un site
  spot ; check-in une visite ; l'affecter à une porte ; la déplacer ; check-out ; créer un rendez-vous puis
  le lier/arriver ; tenter d'affecter 2 visites au même spot → refus ; capture).

### F. Règle dure 34 (CLAUDE.md, module Yard)
> Le statut d'une `YardVisit`/`DockAppointment` ne change QUE via `canTransitionYardVisit`/
> `canTransitionDockAppointment` (`@pulsar/shared/yard`, règle 2) avec claim conditionnel `updateMany`
> (TOCTOU). **Un spot occupé (visite active — CHECKED_IN/ASSIGNED — dessus) ne peut recevoir une autre
> visite** : refus 409 ; l'occupation est **dérivée** (count des visites actives sur le spot), jamais
> dénormalisée. Tout changement de position d'une visite (`spotId`) écrit un `YardMove` dans la **même
> transaction**. N° de documents via `SequencesService` (YV-/DA-, règle 8). Spots et sites sont des
> `Location` du tenant. Tout endpoint Yard est `@RequireModule(MODULE_KEYS.YARD)` + `yard.read|manage`,
> tenant-scopé (règle 1) ; FK (trailer/carrier/location/spot/appointment) vérifiées (règle 9).

## Tests
Unit (`@pulsar/shared`) : `canTransitionYardVisit`/`canTransitionDockAppointment` (valides/invalides/no-op) ;
`isSpotOccupied`.
Unit (API) : `VisitsService.checkIn`+`assign` écrit un YardMove et occupe le spot ; `assign` sur spot occupé
→ 409 ; `checkOut` libère (spotId null, move toSpot null) ; `AppointmentsService` arrive/complete transitions.
E2e (DB seedée) : créer un site Location + spots ; check-in une visite (trailer Fleet) ; l'affecter à une
porte → `board` la montre occupant la porte ; **affecter une 2ᵉ visite à la même porte → 409** ; déplacer ;
check-out → porte libérée ; créer un rendez-vous → check-in lié → rendez-vous ARRIVED ; isolation tenant ;
gating module (403/404 si YARD off). + **vérif navigateur** de `/yard`.

## Hors périmètre (tranches Yard suivantes)
Lien porte de quai ↔ réception/expédition WMS · détention & temps de séjour, facturation de stationnement ·
vue carte géo de la cour avec drag&drop · notifications d'arrivée / SMS chauffeur · portail chauffeur de
self-check-in · optimisation d'affectation des portes · agent de cour (pas d'agentique).
