# Module F — Planning Board (spec)

Backlog: `docs/superpowers/specs/2026-06-18-lebron-roadmap-backlog.md` (Modules additionnels → F).
Branche: `analytics-control-tower`. Décisions prises en autonomie (mandat Lebron).

## But

Une planche de planification dédiée : voir d'un coup les **shipments non assignés**, les **loads
ouverts** (avec utilisation de capacité + warnings), et le **pool de ressources disponibles**
(tracteurs/remorques/chauffeurs), puis **glisser-déposer** un shipment sur un load (assignation) ou
hors d'un load (retrait), et déposer une ressource sur un load (affectation). Tout réutilise les
services TMS existants — aucune nouvelle logique métier d'assignation/capacité.

## Ce qui existe déjà (réutilisé, NE PAS réimplémenter)

- `POST /transportation/shipments/:id/assign-load` `{ loadId, force? }` → `ShipmentsService.assignToLoad`
  (checkCapacity rule 18, maintient `shipment_load_legs`, recompute coût rule 11).
- `POST /transportation/shipments/:id/remove-load` → `removeFromLoad`.
- `POST /transportation/loads/:id/assign` `{ carrierId?, driverId?, vehicleId?, trailerId?, rateId?, force?, mode? }`
  → affectation ressources + checkCapacity + recompute.
- `GET /transportation/shipments?unassigned=true`, `GET /transportation/loads?status=`,
  `GET /transportation/{vehicles,trailers,drivers}`.
- `checkCapacity` (`@pulsar/shared/planning/capacity`) → `CapacityExcess[]`.

## Périmètre LIVRÉ (F-phase-1)

### Backend — 1 endpoint d'agrégation read-only

`GET /api/v1/transportation/planning-board`
- Gardes: `@RequireModule(MODULE_KEYS.TRANSPORTATION)` (classe) + `@RequirePermissions(TRANSPORTATION.PLANNING_READ)`.
- Tenant-scopé (rule 1). Aucun écrit.
- Réponse (projection explicite, pas d'entités Prisma brutes) :
  ```ts
  interface PlanningBoardDto {
    unassignedShipments: PlanningShipment[]; // loadId null, status PENDING
    openLoads: PlanningLoad[];               // status OPEN | PLANNED
    resources: {
      vehicles: PlanningResource[];          // status AVAILABLE
      trailers: PlanningTrailer[];           // status AVAILABLE (+ capacités)
      drivers: PlanningResource[];
    };
  }
  interface PlanningShipment { id; shipmentNumber; status; weightKg?; volumeM3?; pallets?;
    originLabel; destinationLabel; customerName?; }
  interface PlanningLoad { id; loadNumber; status; mode?; carrierName?; driverName?;
    trailerLabel?; capacity?: { weightKg?; volumeM3?; pallets? }; // de la remorque affectée
    totals: { weightKg; volumeM3; pallets };  // somme shipments assignés
    excesses: CapacityExcess[];               // checkCapacity(capacity, totals) — [] si OK ou pas de remorque
    shipments: { id; shipmentNumber }[]; }
  interface PlanningResource { id; label; status; }
  interface PlanningTrailer extends PlanningResource { capacityWeightKg?; capacityVolumeM3?; capacityPallets?; }
  ```
- Le service réutilise les repos/services existants (ou requêtes Prisma directes tenant-scopées en
  lecture). Les `excesses` sont calculés via `checkCapacity` partagé — jamais réimplémenté.
- Cap raisonnable: 100 shipments non assignés, 100 loads ouverts, 100 par type de ressource
  (les pages restent réactives ; documenter le cap).

### Frontend — page `/planning`

- Route `apps/web/src/routes/(app)/planning/+page.svelte`. Pattern `$state`+`$effect`+`load()`,
  `api<T>()`. 3 colonnes :
  1. **Shipments non assignés** — cartes draggables (poids/vol/palettes, O→D, client).
  2. **Loads ouverts** — chaque load = zone de drop ; barres d'utilisation par axe
     (totals/capacity), badge warning si `excesses.length>0` ; liste des shipments dessus
     (chaque shipment retirable / draggable hors du load). En-tête load = zone de drop ressources.
  3. **Ressources dispo** — tracteurs/remorques/chauffeurs draggables.
- **Drag & drop** : HTML5 natif (`draggable`, `dragstart`/`dragover`/`drop`), pas de lib externe.
  - shipment → load : `POST shipments/:id/assign-load {loadId}`. Si 400 (capacité) → toast +
    confirm « Dépasser la capacité ? » → retry avec `force:true`.
  - shipment (sur un load) → colonne non-assignés : `POST shipments/:id/remove-load`.
  - remorque/tracteur/chauffeur → load : `POST loads/:id/assign {trailerId|vehicleId|driverId}`
    (même gestion capacité/force pour la remorque).
  - Après chaque action : recharger la planche (simple `load()`), toast succès/erreur.
- Lien croisé : bouton « Planning Board » depuis `/dispatch` et inversement (léger).

### Navigation

- `apps/web/src/lib/modules/navigation.ts` : domaine `transport`, section « Exécution »,
  ajouter `{ href: '/planning', label: 'Planning Board', perm: PLANNING_READ }`. Ajouter
  `/planning` aux `prefixes` du domaine transport.
- (Univers `transport` déjà présent — rien à faire côté universe.ts.)

## DIFFÉRÉ (F-phase-2, noté au backlog, non livré ici)

- **Plan proposal agent** (l'agent propose un plan d'assignation) — nécessite un outil agent dédié
  + file ProposedAction ; design séparé.
- **Scénario A/B** (comparer deux plans) — dépend du plan-proposal.
- **Carrier options enrichies** in-board (déjà couvert par `/dispatch` rate-options + tender).

## Règles CLAUDE.md applicables

- Rule 1 (tenant isolation sur la requête d'agrégation), 11 (recompute déjà fait par les services
  réutilisés), 18 (checkCapacity déjà fait), 5 (permissions/module gating sur le nouvel endpoint),
  10 ne s'applique pas (endpoint privé, pas `/public`). Pas de nouvelle entité Prisma, pas de
  migration, pas de nouvel enum.

## Tâches

- **F-T1 (backend)** : `PlanningBoardController` + `PlanningBoardService` dans
  `apps/api/src/modules/transportation/planning-board/` (ou dossier `planning/`), enregistrer dans
  le module transportation. DTO de réponse typé. Réutilise services existants + `checkCapacity`.
  Vérifier: API boote, `GET /transportation/planning-board` renvoie 200 avec le bon shape, gating
  module+perm effectif, tenant-scopé.
- **F-T2 (frontend)** : page `/planning` + DnD + nav link + lien croisé dispatch. Vérifier:
  `pnpm --filter web typecheck` 0 erreur ; la page charge ; DnD appelle les bons endpoints.
- Reviewer subagent après chaque tâche (règles CLAUDE.md, pas de duplication de logique, projection
  explicite, gating, force/capacity UX).
