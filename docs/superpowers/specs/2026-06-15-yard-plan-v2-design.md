# Yard Plan v2 — Plan visuel de la cour — Design

> Statut : approuvé (brainstorm 2026-06-15). Élévation UI du module **Yard** (v1 livré, PR #24) : passer
> de la grille de cartes à un **plan 2D interactif de la cour**, façon Fleetbase (outil, pas formulaire).
> Premier des « outils visuels » demandés par Sam pour sortir Pulsar du « pages blanches de formulaires ».
> **Coordination** : l'autre agent refait des interfaces web-only **sans toucher schéma/API/shared ni mes
> data models** (cf. `docs/superpowers/plans/2026-06-15-fleetbase-ops-ui-gap.md`). Cet outil exige une
> nouvelle capacité backend (coordonnées de spot) → **ma lane**, complémentaire, zéro collision.

## Objectif

Transformer `/yard` en **plan 2D de la cour** : les spots sont positionnés sur une grille, les remorques
se **glissent** sur les portes/places, un **tiroir de contexte** s'ouvre au clic (visite, séjour, journal
des mouvements). On voit l'état de la cour d'un coup d'œil et on opère par glisser-déposer.

## Contexte réutilisé (Yard v1, ne pas reconstruire)

- `YardSpot` (`type` DOCK_DOOR/PARKING/STAGING, `code`, `locationId`), `YardVisit` (statut CHECKED_IN→
  ASSIGNED→DEPARTED, `spotId`), `YardMove` (journal append-only), `DockAppointment`.
- Endpoints existants : `/yard/board?locationId=` (spots + `occupyingVisit` dérivé + `unassigned`),
  `/yard/visits` (+ `:id/assign`, `:id/move`, `:id/check-out`), `/yard/spots` (CRUD).
- Règle 34 : occupation **dérivée** (un spot = au plus 1 visite active, refus 409), tout changement de
  `spotId` écrit un `YardMove` dans la même transaction. **Inchangé** par cette tranche.
- Composants UI existants : design system `$lib/components/ui` (Badge/Button/Card/Modal/Select…),
  `api()`/`toast`. (On n'utilise PAS Leaflet — c'est un plan schématique, pas une carte géo.)

## Décisions verrouillées (brainstorm)

1. **Grille à aimantation** : `posX` = colonne, `posY` = rangée (entiers ≥ 0). Pas de pixel libre.
2. **Drag-and-drop natif HTML5** (`draggable` + `dragover`/`drop`) — zéro dépendance.
3. **`posX/posY` = display-only** : n'affectent JAMAIS occupation/affectation/transitions (règle 34
   préservée), comme la géométrie de route en phase 10. Persistance via un endpoint de disposition dédié.
4. Le plan remplace la grille de cartes v1 sur `/yard` ; le board API reste la source.

## Architecture

### A. Schéma (29ᵉ migration — minuscule)
`YardSpot` += `posX Int?`, `posY Int?` (null = non placé sur le plan). Aucun autre changement, aucun
nouvel index requis (lecture via le board déjà filtré par tenant/location).

### B. Backend (module Yard, gated YARD, tenant-scopé règle 1)
- `SpotsService.create`/`update` acceptent `posX?`/`posY?` (passés tels quels ; pas de contrainte d'unicité
  de cellule côté serveur — deux spots peuvent se chevaucher visuellement, l'UI gère, YAGNI).
- **`updateLayout(tenantId, positions: {id, posX, posY}[])`** : `$transaction` de `updateMany({ where: { id, tenantId }, data: { posX, posY } })` par spot (ignore les ids hors tenant — `updateMany` scopé). Audit `STATUS_CHANGE`/`UPDATE` sur entityType `yard-layout` (une entrée récap). Endpoint **`PUT /yard/spots/layout`** (`yard.manage`).
- `VisitsService.get` : ajouter `moves: { include: { fromSpot: { select: { code } }, toSpot: { select: { code } } }, orderBy: { movedAt: 'asc' } }` à l'`include` (pour le journal du tiroir).
- `board` : les spots renvoyés incluent déjà tout le modèle → `posX/posY` présents automatiquement après la migration ; vérifier que la projection ne les exclut pas (le board fait un `findMany` complet, donc OK).
- DTO : `LayoutDto { positions: { id: string; posX: number; posY: number }[] }` (class-validator : `@IsArray`, `@ValidateNested({each:true})`, `@Type(() => LayoutPositionDto)`; `LayoutPositionDto { @IsString id; @IsInt @Min(0) posX; @IsInt @Min(0) posY }`).

### C. Web — `/yard` refondu en plan (composants isolés)
- **`apps/web/src/lib/components/yard/YardPlan.svelte`** : le canevas. Reçoit `spots` (avec posX/posY +
  occupyingVisit), `unassigned`, `editing` (bool), et émet des callbacks (`onAssign(visitId, spotId)`,
  `onMove(visitId, spotId)`, `onOpenSpot(spot)`, `onLayoutChange(positions)`).
  - Rendu : `display:grid` dont les colonnes/rangées couvrent `max(posX)+1` × `max(posY)+1` (bornes calculées,
    min 6×4 pour aérer). Chaque spot placé est une tuile à `grid-column/row`. Spots non placés (`posX==null`)
    → bac latéral « Spots non placés » (seulement visible en mode édition).
  - Tuile : code + type (icône/teinte), tons **libre** (neutre), **occupé** (warn) — affiche n° visite,
    remorque/plaque, direction, **durée de séjour** (calc client `now - checkInAt`), **inactif** (gris).
- **Mode opération** (défaut) :
  - chips « À placer » (visites actives sans spot) **draggables** ; déposées sur une tuile **libre** →
    `onAssign` → `POST /yard/visits/:id/assign { spotId }`.
  - une tuile **occupée** est draggable ; déposée sur une tuile **libre** → `onMove` → `POST .../:id/move`.
  - drop sur une tuile occupée → rien + `toast.error` (et le serveur renverrait 409 de toute façon).
  - clic sur une tuile → ouvre le tiroir.
- **Mode édition** (toggle « Éditer la disposition ») :
  - chaque tuile devient déplaçable de cellule en cellule (drag sur la grille → met à jour posX/posY local) ;
    les spots non placés se glissent du bac sur la grille.
  - bouton **« Enregistrer la disposition »** → `PUT /yard/spots/layout { positions }` → toast + reload ;
    **« Annuler »** restaure l'état serveur.
- **`apps/web/src/lib/components/yard/YardContextDrawer.svelte`** : panneau latéral (overlay réutilisant le
  pattern existant, sinon une colonne fixe). Au clic d'une tuile occupée : `GET /yard/visits/:id` →
  remorque/plaque, transporteur, chauffeur, direction, check-in, **séjour**, **journal des mouvements**
  (de → à, horodatage), rendez-vous lié ; actions **Déplacer** (picker de spot libre) / **Check-out**.
- **`/yard/+page.svelte`** : sélecteur de site (comme v1), charge `GET /yard/overview` + `GET /yard/board?locationId=`,
  rend `YardPlan` + le tiroir + les 4 cartes KPI (conservées en bandeau). État vide si aucun spot placé →
  « Place tes spots » + bouton vers le mode édition. Recharge après chaque action.
- Les pages `/yard/gate`, `/yard/appointments`, `/yard/spots` restent (le plan est l'évolution de `/yard`).

### D. Règle dure 34 (clause display ajoutée)
> (Yard Plan v2) `YardSpot.posX/posY` sont **display-only** (disposition du plan de cour) : ils ne sont
> JAMAIS utilisés dans l'occupation, l'affectation ou les transitions (qui restent dérivées + serveur,
> règle 34). `PUT /yard/spots/layout` ne persiste que des coordonnées d'affichage (tenant-scopé,
> `yard.manage`). Le glisser-déposer du plan appelle les endpoints existants `assign`/`move` (gardés).

### E. Tests
Unit (API) : `SpotsService.updateLayout` met à jour les positions des spots du tenant et **ignore** les ids
d'un autre tenant (updateMany scopé) ; `VisitsService.get` inclut les `moves` triés.
E2e : `PUT /yard/spots/layout` persiste `posX/posY` (relu via `/yard/board`) ; rejet d'un id hors tenant
(silencieux/scopé) ; `GET /yard/visits/:id` renvoie le journal des mouvements après un assign+move ; gating.
**Vérif navigateur** : mode édition → placer DOOR-1/P-1 → enregistrer → mode opération → glisser une visite
« à placer » sur une porte (affecte) → déplacer vers le parc → ouvrir le tiroir (séjour + journal) →
drop sur une tuile occupée refusé → check-out depuis le tiroir → capture.

## Hors périmètre v2
Carte géo/satellite réelle · zoom/pan infini · dessin de bâtiments/allées · redimensionnement ou rotation
de tuiles · placement automatique intelligent · drag tactile mobile fin · multi-site sur un même plan ·
contraintes d'unicité de cellule côté serveur.
