# WMS v2 — Tressage WMS ↔ TMS — Design

> Statut : approuvé (brainstorm 2026-06-15). Tranche « tressée » qui relie le module **Light WMS** (v1,
> livré) au **TMS** : le WMS prépare (picke) les **shipments sortants**. Feature pure, aucune agentique.
> Bâtit sur le WMS v1. Travail mené en parallèle d'un autre agent (agents/intégrations/UI dispatch) —
> ce design reste **dans la lane WMS** (aucun contrôleur TMS modifié, aucun changement du workflow dispatch).

## Objectif

Permettre au WMS de **préparer les shipments sortants** du TMS : un `PickOrder` peut référencer un
`Shipment` dont l'origine est un entrepôt WMS. Compléter le pick décrémente le stock (mécanique WMS v1
intacte) et marque le shipment **« préparé / prêt à charger »** — un état **dérivé** (lu depuis les pick
orders liés), jamais un nouveau statut, jamais un blocage du dispatch.

## Contexte vérifié (TMS existant, ne pas reconstruire)

- `Shipment` (`schema.prisma`) : `status: ShipmentStatus` (PENDING→PLANNED→DISPATCHED→IN_TRANSIT→DELIVERED→
  CLOSED→CANCELLED), `originLocationId` (Location d'origine = lieu de pickup), `destinationLocationId`,
  `weightKg`/`volumeM3`/`palletCount`, `loadId?`, fenêtres `plannedPickup*`. **Aucune ligne d'articles
  (SKU)** sur le shipment.
- `Location.type: LocationType` inclut `WAREHOUSE`. Un entrepôt WMS = une Location `WAREHOUSE` (le `Bin`
  WMS référence un `locationId`).
- WMS v1 : `PickOrder` (`locationId`, `status: PickOrderStatus` OPEN→PICKED→COMPLETED→CANCELLED, n° PK-)
  + `PickLine` (itemId, fromBinId, qty). `PickingService.complete` poste des `StockMovement PICK` et
  décrémente `InventoryLevel` dans une transaction (règle 33). `ShipmentStatus`/`PickOrderStatus` sont des
  machines d'état pures dans `@pulsar/shared` (règle 2).

## Décisions verrouillées (brainstorm)

1. `PickOrder.shipmentId` **optionnel** (un pick order reste utilisable seul, comme en v1).
2. **Lignes manuelles** : l'opérateur saisit les SKU à prélever. Pas de lignes d'articles ajoutées au
   `Shipment` (gros changement TMS évité).
3. **Décrément à la complétion** du pick (invariant WMS v1 intact, règle 33). Pas de réservation/soft-allocation.
4. **Statut « préparé » dérivé** : un shipment est « préparé » s'il a ≥1 `PickOrder` lié au statut
   `COMPLETED`. **Aucun nouveau `ShipmentStatus`, aucun blocage du dispatch** (règle 2 préservée).
5. **Lane WMS uniquement** : aucun contrôleur TMS modifié, aucune page dispatch touchée (l'autre agent y
   travaille). Toute la surface neuve vit dans le module WMS.

## Architecture

### A. Entité (27ᵉ migration — un seul champ ajouté)
`PickOrder` (modèle existant) gagne :
- `shipmentId String?`
- relation `shipment Shipment? @relation(fields: [shipmentId], references: [id], onDelete: SetNull)`
- `@@index([tenantId, shipmentId])`

Back-relation sur `Shipment` : `pickOrders PickOrder[]`. **Aucun nouveau modèle, aucun nouvel enum.**

### B. État dérivé (`@pulsar/shared/src/wms/`, pur testé)
Nouveau helper pur dans `wms.workflow.ts` (ou un fichier `fulfillment.ts` du même dossier) :
```ts
export type ShipmentPickStatus = 'NOT_PICKED' | 'PICKING' | 'PICKED';
// Dérive le statut de préparation d'un shipment depuis les statuts de ses pick orders liés :
//   aucun pick OU tous CANCELLED            -> NOT_PICKED
//   ≥1 COMPLETED                            -> PICKED
//   sinon (≥1 OPEN/PICKED non terminé)      -> PICKING
export function deriveShipmentPickStatus(pickOrderStatuses: PickOrderStatus[]): ShipmentPickStatus
```
Pur, browser-safe, testé aux bornes. (Réutilise l'enum `PickOrderStatus` déjà exporté.)

### C. Backend (module WMS, gated `@RequireModule(MODULE_KEYS.WMS)`, tenant-scopé règle 1)
- `PickingService.create` accepte `shipmentId?` : si fourni →
  - charge le shipment (`findFirst { id, tenantId }`) → NotFound si absent ;
  - exige `pickOrder.locationId === shipment.originLocationId` ET que cette Location soit `type === 'WAREHOUSE'`
    (sinon `BadRequestException('Pick order location must match the shipment origin warehouse')`) ;
  - persiste `shipmentId` sur le pick order. `complete`/`cancel`/`addLine` inchangés.
- `PickListQueryDto` gagne `shipmentId?` (filtre `findMany`).
- `PickingService.get`/`list` incluent `shipment: { select: { id, shipmentNumber, status } }` (projection,
  jamais de `tenantId` exposé inutilement).
- **`FulfillmentService`** (nouveau, module WMS), constructeur `(private prisma: PrismaService)` :
  - `pendingShipments(tenantId)` : `shipment.findMany` où `tenantId`, `status in [PENDING, PLANNED]`,
    `originLocation.type === 'WAREHOUSE'`, `take 100`, include `originLocation`/`destinationLocation`
    `{ code, name }` + `pickOrders { select: { id, number, status } }` ; mappe chaque shipment →
    `{ ...projection, pickStatus: deriveShipmentPickStatus(pickOrders.map(p=>p.status)) }`. Tri par
    `plannedPickupEarly asc`.
  - `shipmentFulfillment(tenantId, shipmentId)` : le shipment (projection) + ses pick orders liés (avec
    lignes) + `pickStatus` dérivé ; NotFound si shipment absent/non-tenant.
- Contrôleur `FulfillmentController` (`@Controller('wms/fulfillment')`, `@RequireModule(WMS)`) :
  `GET /pending` (READ), `GET /shipments/:id` (READ). Le `POST /wms/pick-orders { ..., shipmentId? }`
  réutilise `PickingController` existant.

### D. Web — section `/wms` (aucune page dispatch/TMS modifiée)
- **`/wms/fulfillment`** (nouveau workbench) : **file sortante** — table des shipments à préparer
  (`GET /wms/fulfillment/pending`) : n°, origine (entrepôt), O→D, fenêtre pickup, poids, **badge de
  préparation** (NOT_PICKED gris / PICKING ambre / PICKED vert). Action **« Créer le pick order »**
  pré-remplie (locationId = origine, shipmentId lié) → `POST /wms/pick-orders` → redirige/affiche le pick.
  Détail d'un shipment (`GET /wms/fulfillment/shipments/:id`) : ses pick orders + statut.
- **`/wms/picking`** : affiche la réf shipment liée (`PK-… ↔ SH-…`) quand présente + filtre `?shipmentId`.
- Nav : entrée **« Préparation »** ajoutée au groupe Warehouse (gated WMS), entre Réception et Prélèvement.
- *(optionnel, seulement si une page détail shipment existe déjà et que l'ajout est trivial)* un panneau
  **lecture seule** « Préparation entrepôt » ; sinon omis (ne rien casser côté TMS).
- **DoD** : build + typecheck + **inspection navigateur** (créer un shipment origine = entrepôt WMS ;
  `/wms/fulfillment` le liste NOT_PICKED ; créer le pick order lié ; ajouter une ligne ; compléter →
  stock décrémenté + le shipment ressort PICKED ; capture).

### E. Règle dure (extension de la 33, ajoutée à CLAUDE.md)
> (WMS v2) Un `PickOrder` peut référencer un `Shipment` (`shipmentId?`) ; dans ce cas son `locationId`
> DOIT être égal à `shipment.originLocationId` et cette Location être de type `WAREHOUSE` (validé dans
> `PickingService.create`). Le décrément de stock reste à la complétion du pick (règle 33, inchangée).
> L'état « préparé » d'un shipment est **dérivé** de ses pick orders liés (`deriveShipmentPickStatus`,
> pur `@pulsar/shared`) — **jamais** un nouveau `ShipmentStatus`, jamais un blocage du dispatch
> (règle 2 préservée). Toute la surface vit dans le module WMS (`@RequireModule(WMS)`, `wms.read|manage`,
> tenant-scopé règle 1) ; aucun contrôleur TMS n'est modifié.

## Tests
Unit (`@pulsar/shared`) : `deriveShipmentPickStatus` (aucun pick → NOT_PICKED ; tous CANCELLED →
NOT_PICKED ; ≥1 OPEN/PICKED → PICKING ; ≥1 COMPLETED → PICKED ; mélange COMPLETED+autres → PICKED).
Unit (API) : `PickingService.create` avec `shipmentId` valide persiste le lien ; rejette si
`locationId !== originLocationId` ou origine non-WAREHOUSE ; rejette shipment d'un autre tenant.
E2e (DB seedée) : créer une Location WAREHOUSE + bins + item + stock ; créer un shipment (origine =
l'entrepôt) ; `GET /wms/fulfillment/pending` le liste avec `pickStatus NOT_PICKED` ; `POST /wms/pick-orders
{ locationId, shipmentId }` ; ajouter une ligne ; `complete` → stock décrémenté ; `GET /wms/fulfillment/
shipments/:id` → `pickStatus PICKED` ; rejet d'un pick order lié dont `locationId` ≠ origine (400) ;
isolation tenant ; gating WMS. + **vérif navigateur** de `/wms/fulfillment`.

## Hors périmètre (tranches suivantes)
Réservation / soft-allocation de stock · lignes d'articles (SKU) sur le `Shipment` · liste de prélèvement
auto-dérivée du shipment · blocage du dispatch tant que non préparé · ondes de picking & optimisation de
parcours · décrément automatique au passage DISPATCHED · retours / RMA · réception liée aux TransportOrders
entrants (inbound depuis le TMS).
