# Light WMS — Module v1 — Design

> Statut : approuvé (brainstorm 2026-06-15). **Module métier neuf** (feature pure — aucune agentique,
> décidé avec Sam). Suit la recette « Adding a business module » de CLAUDE.md. 2ᵉ module de l'expansion
> modulaire post-pivot (après Fleet). Slice v1 = **boucle entrepôt complète, autonome** (Sam a choisi
> « boucle complète » + « autonome v1 »).

## Objectif

Donner un poste de travail d'entrepôt léger : suivre le **stock** (quantité par article × emplacement)
et le faire bouger via les trois flux d'un WMS — **réception (inbound) → rangement (putaway) →
prélèvement (picking, outbound)**. Autonome en v1 : les documents (réceptions, ordres de prélèvement)
sont saisis dans le module ; **aucun couplage dur au TMS** (l'intégration TMS↔WMS — prélever pour
honorer un Shipment planifié — est une tranche « tressée » ultérieure).

## Principe central (règle dure 33, voir §F)

Tout changement de stock passe par un **`StockMovement`** (registre append-only : source de vérité +
historique/audit) ET met à jour **`InventoryLevel`** (solde courant par article × bin) **dans la même
transaction** — jamais de mutation directe d'un solde hors mouvement. Toute **sortie** (PICK) vérifie
la **disponibilité** avant de poster : un mouvement qui rendrait un bin négatif est refusé, **sauf**
un `ADJUSTMENT` explicite (cycle count / correction). Même esprit que l'invariant `shipment_load_legs`
(règle 18) et le snapshot figé (règle 16).

## Contexte réutilisé (ne pas reconstruire)

- **Entrepôt = `Location` de type `WAREHOUSE`** (modèle `Location` existant, enum `LocationType.WAREHOUSE`).
  Pas de nouvelle entité entrepôt ; un `Bin` référence un `locationId` (une Location WAREHOUSE).
- `MODULE_KEYS.WMS = 'wms'` déjà réservé dans `MODULE_CATALOG` (« Light WMS », `available:false` → flip
  à `true`).
- `SequencesService.nextNumber()` (règle 8) pour les n° de documents (RC- / PK-). `OwnershipService`
  (règle 9) pour les FK acceptées en payload. `AuditLogsService` (règle 6). État via machines d'état
  `@pulsar/shared/wms` (règle 2) ; enums miroir Prisma (règle 3).

## Décisions verrouillées (brainstorm)

1. **v1 = boucle complète** : Inventaire + Réception + Rangement + Prélèvement.
2. **Autonome v1** : pas de couplage dur au TMS (documents saisis manuellement, `refType`/`refId` libres).
3. **2 permissions coarse** : `wms.read`, `wms.manage`.
4. **`InventoryLevel` dérivé**, maintenu transactionnellement avec chaque `StockMovement` (jamais muté seul).
5. **Putaway = opération de déplacement** (move stock), pas un document lourd.
6. **Ajustement = seul chemin autorisé à créer/réduire du stock hors flux** (mouvement `ADJUSTMENT`).
7. **Bins plats** (pas de hiérarchie zone/allée/rack) — léger.
8. **Pas de conversions UOM, ni lots/séries/péremption** — YAGNI.
9. **Aucun agent.**

## Architecture

### A. Activation du module
- `packages/shared/src/modules.ts` : `wms` → `available: true`.
- `packages/shared/src/permissions.ts` : `WMS: { READ: 'wms.read', MANAGE: 'wms.manage' }` au map +
  2 entrées catalogue (récupérées par le seed).
- `apps/api/src/modules/wms/wms.module.ts` enregistré dans `app.module.ts` ; tous les contrôleurs
  `@RequireModule(MODULE_KEYS.WMS)`.
- Web : groupe nav « Warehouse » conditionné sur `$auth.tenant.enabledModules.includes(MODULE_KEYS.WMS)`.
- Activable via `PATCH /modules/wms` (ou reseed).

### B. Entités (26ᵉ migration)

**`WmsItem`** (`@@map("wms_items")`) : item master / SKU.
`id, tenantId, sku String, name String, unit String @default("EA"), barcode String?, isActive Boolean
@default(true), createdById String?, createdAt, updatedAt`. Unicité `@@unique([tenantId, sku])`.
Index `@@index([tenantId])`.

**`Bin`** (`@@map("wms_bins")`) : emplacement dans un entrepôt.
`id, tenantId, locationId String (FK Location), code String, kind BinKind @default(STORAGE), isActive
Boolean @default(true), createdAt, updatedAt`. Unicité `@@unique([tenantId, locationId, code])`. Index
`@@index([tenantId, locationId])`. `BinKind: RECEIVING | STORAGE | SHIPPING`.

**`InventoryLevel`** (`@@map("wms_inventory_levels")`) : solde courant dérivé.
`id, tenantId, itemId String (FK WmsItem), binId String (FK Bin), qtyOnHand Decimal @db.Decimal(14,3)
@default(0), updatedAt`. Unicité `@@unique([tenantId, itemId, binId])`. Index `@@index([tenantId, itemId])`,
`@@index([tenantId, binId])`. **Jamais muté hors d'une transaction qui écrit aussi un `StockMovement`.**

**`StockMovement`** (`@@map("wms_stock_movements")`) : ledger append-only (source de vérité).
`id, tenantId, type StockMovementType, itemId String (FK), fromBinId String? (FK Bin), toBinId String?
(FK Bin), qty Decimal @db.Decimal(14,3), refType String?, refId String?, note String?, createdById String?,
createdAt DateTime @default(now())`. Index `@@index([tenantId, itemId])`, `@@index([tenantId, createdAt])`,
`@@index([tenantId, refType, refId])`. `StockMovementType: RECEIPT | MOVE | PICK | ADJUSTMENT`.
Convention de signe : `RECEIPT` → entrée dans `toBin` ; `PICK` → sortie de `fromBin` ; `MOVE` →
`fromBin`→`toBin` ; `ADJUSTMENT` → `qty` signé (positif = entrée `toBin`, négatif = sortie `fromBin`).

**`Receipt`** (`@@map("wms_receipts")`) + **`ReceiptLine`** (`@@map("wms_receipt_lines")`) : doc inbound.
`Receipt: id, tenantId, number String (RC-, SequencesService), locationId String (FK Location WAREHOUSE),
status ReceiptStatus @default(DRAFT), reference String?, note String?, postedAt DateTime?, createdById
String?, createdAt, updatedAt`. Unicité `@@unique([tenantId, number])`. Index `@@index([tenantId, status])`.
`ReceiptLine: id, tenantId, receiptId String (FK), itemId String (FK), toBinId String (FK Bin), qty Decimal
@db.Decimal(14,3)`. `ReceiptStatus: DRAFT | POSTED | CANCELLED`.

**`PickOrder`** (`@@map("wms_pick_orders")`) + **`PickLine`** (`@@map("wms_pick_lines")`) : doc outbound.
`PickOrder: id, tenantId, number String (PK-), locationId String (FK Location WAREHOUSE), status
PickOrderStatus @default(OPEN), reference String?, note String?, completedAt DateTime?, createdById String?,
createdAt, updatedAt`. Unicité `@@unique([tenantId, number])`. Index `@@index([tenantId, status])`.
`PickLine: id, tenantId, pickOrderId String (FK), itemId String (FK), fromBinId String (FK Bin), qty Decimal
@db.Decimal(14,3)`. `PickOrderStatus: OPEN | PICKED | COMPLETED | CANCELLED`.

Back-relations `Tenant` requises pour tous les modèles ; `Location` reçoit des back-relations
`Bin[]`, `Receipt[]`, `PickOrder[]`.

### C. État (`@pulsar/shared/src/wms/`)
```ts
export enum StockMovementType { RECEIPT, MOVE, PICK, ADJUSTMENT }
export enum BinKind { RECEIVING, STORAGE, SHIPPING }
export enum ReceiptStatus { DRAFT, POSTED, CANCELLED }
export enum PickOrderStatus { OPEN, PICKED, COMPLETED, CANCELLED }

export function canTransitionReceipt(from: ReceiptStatus, to: ReceiptStatus): boolean
// DRAFT→POSTED, DRAFT→CANCELLED ; from===to no-op ; POSTED/CANCELLED terminaux

export function canTransitionPickOrder(from: PickOrderStatus, to: PickOrderStatus): boolean
// OPEN→PICKED, OPEN→COMPLETED, PICKED→COMPLETED, OPEN/PICKED→CANCELLED ; from===to no-op

// helper pur (testabilité) : applique un delta à un solde, refuse le négatif sauf override
export function applyToBalance(current: number, delta: number, opts?: { allowNegative?: boolean }):
  { ok: true; next: number } | { ok: false; reason: 'NEGATIVE' }
```
Tout est pur, browser-safe (aucun import Node). Enums miroir dans `schema.prisma` (règle 3).

### D. Services + API (module WMS, gated `@RequireModule(MODULE_KEYS.WMS)`, tenant-scopé règle 1)
- `ItemsService` / `BinsService` : CRUD master-data ; `@Audit` (règle 14) ; `assertOwnedIfSet` sur
  `locationId` (règle 9, et la Location doit être de type WAREHOUSE).
- `InventoryService` :
  - `levels(tenantId, query)` : soldes filtrés par item / bin / location, paginés.
  - `move(tenantId, userId, dto)` (= putaway/transfert) : `{ itemId, fromBinId, toBinId, qty }` →
    vérif dispo sur `fromBin`, transaction `{ StockMovement MOVE ; décrément fromBin ; incrément toBin }`.
  - `adjust(tenantId, userId, dto)` : `{ itemId, binId, qtyDelta, note }` → `StockMovement ADJUSTMENT`
    (signe), maj solde (négatif autorisé seulement ici, refusé si le résultat < 0 quand même : un
    ajustement ne descend pas sous 0 — un ajustement négatif > stock est refusé). Audit.
  - private `postMovement(tx, ...)` réutilisé par tous : écrit le mouvement + upsert le(s) `InventoryLevel`
    dans la **même** transaction (jamais l'un sans l'autre).
- `ReceivingService` : CRUD receipt (DRAFT) + lignes ; `post(tenantId, userId, id)` → transition gardée
  `canTransitionReceipt` + claim conditionnel `updateMany DRAFT→POSTED`, puis pour chaque ligne un
  `StockMovement RECEIPT` (toBin) + incrément des soldes, en une transaction ; `cancel` (DRAFT→CANCELLED).
  Audit before/after (règle 6).
- `PickingService` : CRUD pick order (OPEN) + lignes ; `complete(tenantId, userId, id)` → transition gardée
  + claim `updateMany`, **vérif dispo de chaque ligne** (refus 409 si insuffisant), puis `StockMovement
  PICK` (fromBin) + décrément, en une transaction ; `cancel`. Audit.
- `WmsOverviewService.overview(tenantId)` : `{ distinctItems, totalOnHand, openReceipts, openPickOrders,
  negativeBins:[...], emptyHotBins? }` — calculé à la lecture.
- Contrôleurs (`fleet`-style) : `/wms/items` (CRUD), `/wms/bins` (CRUD), `/wms/inventory` (GET levels,
  POST `move`, POST `adjust`), `/wms/receipts` (GET list/:id, POST, POST `:id/lines`, DELETE `:id/lines/:lineId`,
  POST `:id/post`, POST `:id/cancel`), `/wms/pick-orders` (idem + `:id/complete`, `:id/cancel`),
  `/wms/overview` (GET). `wms.read` sur les GET, `wms.manage` sur les mutations.

### E. Web — section `/wms` (postes opérationnels, pas des tables admin)
- **`/wms`** : dashboard d'attention (articles distincts, total on-hand, réceptions ouvertes, pick orders
  ouverts, **alertes bins négatifs**) via `GET /wms/overview` + raccourcis vers les workbenches.
- **`/wms/inventory`** : navigateur de stock (bascule par article / par bin, recherche, qty on-hand) +
  actions **Déplacer** (putaway/transfert) et **Ajuster**.
- **`/wms/receiving`** : workbench réception — liste des réceptions + créer (choisir entrepôt) → ajouter
  des lignes (article + bin réception + qty) → **Poster** (soldes bumpés) ; puis ranger depuis l'inventaire.
- **`/wms/picking`** : workbench prélèvement — liste + créer → lignes (article + bin source + qty, dispo
  affichée) → **Compléter** (soldes décrémentés, refus si insuffisant).
- **`/wms/items`** + **`/wms/bins`** : master-data (CRUD, pattern web existant).
- Nav : nouveau groupe **« Warehouse »** gated WMS. Pattern web existant (Card/Badge/Button, `api()`,
  `toast`, `$state`+`$effect`).
- **DoD** : build + typecheck + **inspection navigateur** (login, activer le module si besoin, créer un
  article + des bins, recevoir → poster → voir le solde, ranger en stockage, créer un pick → compléter →
  voir le décrément, tenter une sortie > dispo → refus, capture).

### F. Règle dure 33 (CLAUDE.md, module WMS)
> Dans le module WMS, **tout** changement de stock passe par un `StockMovement` (registre append-only,
> source de vérité) ET met à jour le `InventoryLevel` correspondant **dans la même transaction**
> (`InventoryService.postMovement`) — jamais de mutation directe d'un solde. Toute sortie (`PICK`, et la
> jambe sortante d'un `MOVE`) **vérifie la disponibilité** avant de poster ; un mouvement qui rendrait un
> bin négatif est refusé (409), **sauf** un `ADJUSTMENT` explicite — et même un ajustement ne descend pas
> un bin sous 0. Les statuts `Receipt`/`PickOrder` ne changent que via `canTransitionReceipt`/
> `canTransitionPickOrder` (`@pulsar/shared/wms`, règle 2) avec claim conditionnel `updateMany` (TOCTOU) ;
> n° de documents via `SequencesService` (RC-/PK-, règle 8). L'entrepôt est une `Location` type `WAREHOUSE`
> (pas de nouvelle entité). Tout endpoint WMS est `@RequireModule(MODULE_KEYS.WMS)` + `wms.read|manage`,
> tenant-scopé (règle 1) ; FK vérifiées par `OwnershipService` (règle 9).

## Tests
Unit (`@pulsar/shared`, vitest) : `canTransitionReceipt`/`canTransitionPickOrder` (valides/invalides/no-op) ;
`applyToBalance` (entrée, sortie, refus négatif, override).
Unit (API) : `ReceivingService.post` bump le solde + crée les mouvements ; `PickingService.complete`
vérifie la dispo et décrémente, refuse > dispo ; `InventoryService.move` transfère (décrément+incrément) ;
`adjust` (positif/négatif, refus sous 0) ; `postMovement` n'écrit jamais un solde sans mouvement.
E2e (DB seedée) : boucle complète item→bins→receive→post→putaway(move)→pick→complete avec soldes vérifiés
via `GET /wms/inventory` ; refus de pick > dispo (409) ; isolation tenant (item/stock d'un autre tenant
invisible/refusé) ; module gating (endpoint 403/404 si WMS off). + **vérif navigateur** de `/wms`.

## Hors périmètre (tranches WMS suivantes)
Couplage TMS (picking depuis Shipments/TransportOrders, décrément à l'expédition) · UOM & conversions ·
lots / numéros de série / dates de péremption (FEFO) · ondes de picking & optimisation de parcours ·
scan code-barres natif / terminaux RF · réappro & seuils min/max automatiques · agent d'entrepôt
(pas d'agentique pour l'instant).
