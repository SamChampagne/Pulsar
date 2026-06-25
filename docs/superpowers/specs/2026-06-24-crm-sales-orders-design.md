# CRM Commandes de vente (Sales Orders) — Cycle 3

**Date:** 2026-06-24
**Statut:** auto-validé (autonomie déléguée — `pulsar-autonomie-execution`)
**Module:** CRM (`MODULE_KEYS.CRM`)
**Branche:** `crm-email-threads` (travail CRM groupé)

## Objectif

Donner au CRM des **commandes de vente** : transformer un deal gagné (avec ses lignes de produit)
en une **commande** suivie par un cycle de statut (brouillon → confirmée → exécutée → facturée),
numérotée. C'est le maillon deal → commande, prérequis des connecteurs (Shopify) et du lien Billing.

## Décision de nommage (tranchée)

**`SalesOrder` / « Commande »** vit dans le domaine **commercial (CRM)** et est **distincte** du
`TransportOrder` du TMS. Une commande de vente = engagement commercial de livrer des
produits/services à un client (le *quoi* vendu). Un transport order = instruction d'expédition
TMS (le *comment* le fret bouge). Couches différentes, pas de fusion. Préfixe de numéro **`SO-`**
(le TMS utilise `TO-`).

## Modèle de données (Prisma + migration additive)

```prisma
model SalesOrder {
  id           String           @id @default(cuid())
  tenantId     String
  number       String                       // SO-xxxx via SequencesService
  status       SalesOrderStatus @default(DRAFT)
  companyId    String                        // CRM company (source commerciale)
  customerId   String?                       // Customer lié (si converti)
  dealId       String?                       // deal d'origine
  ownerUserId  String?
  currency     String           @default("CAD")
  totalAmount  Decimal          @default(0)  // recalculé depuis les lignes
  notes        String?
  customData   Json?
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt
  tenant   Tenant       @relation(fields: [tenantId], references: [id])
  company  CrmCompany   @relation(fields: [companyId], references: [id])
  lineItems SalesOrderLineItem[]
  @@unique([tenantId, number])
  @@index([tenantId, status])
  @@index([tenantId, companyId])
  @@map("sales_orders")
}

model SalesOrderLineItem {
  id           String   @id @default(cuid())
  tenantId     String
  salesOrderId String
  productId    String?
  name         String
  quantity     Decimal  @default(1)
  unitPrice    Decimal  @default(0)
  discountPct  Decimal  @default(0)
  currency     String   @default("CAD")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  salesOrder SalesOrder  @relation(fields: [salesOrderId], references: [id], onDelete: Cascade)
  product    CrmProduct? @relation(fields: [productId], references: [id])
  @@index([tenantId, salesOrderId])
  @@map("sales_order_line_items")
}
```
Back-relations explicites : `Tenant.salesOrders`, `CrmCompany.salesOrders`, `CrmProduct.salesOrderLineItems`. Nouvel enum **`SalesOrderStatus`** dans `@pulsar/shared` ET mirroré dans `schema.prisma` (règle 3) : `DRAFT, CONFIRMED, FULFILLED, INVOICED, CANCELLED`.

## State machine (`packages/shared/src/crm/sales-order.workflow.ts`, règle 2)

`SalesOrderStatus` enum + `canTransitionSalesOrder(from, to): boolean` (pur, testé). Transitions :
- `DRAFT → CONFIRMED | CANCELLED`
- `CONFIRMED → FULFILLED | CANCELLED`
- `FULFILLED → INVOICED`
- `INVOICED`, `CANCELLED` terminaux.
Helper `isSalesOrderOpen(status)` (= non terminal). Mirroir du style de `crm.workflow.ts`.

## Numérotation

Ajouter la clé `'sales-order'` (préfixe `SO`) au type `SequenceKey` + `PREFIXES` de
`apps/api/src/prisma/sequences.service.ts` (règle 8 : numéros via `SequencesService.nextNumber`,
jamais générés autrement). Pas de surcharge de préfixe par settings en v1.

## API (module CRM, `@RequireModule(CRM)`, R1, R9, R6)

### Commandes — `sales-orders.{controller,service}.ts`
- `GET /crm/sales-orders` — `Paginated`, filtres `status`, `companyId`, `search` (number) | `crm.read`
- `GET /crm/sales-orders/:id` — commande + company + lignes | `crm.read`
- `POST /crm/sales-orders` — créer (DRAFT) : `companyId` requis (FK vérifiée), `number` via `nextNumber`, `customerId`/`dealId`/`notes`/`currency` optionnels | `crm.manage`
- `PATCH /crm/sales-orders/:id` — maj `notes`/`ownerUserId`/`currency` (PAS `status` ni `number`) | `crm.manage`
- `POST /crm/sales-orders/:id/confirm|fulfill|cancel` — transitions via `canTransitionSalesOrder`
  (claim conditionnel `updateMany` TOCTOU + audit `STATUS_CHANGE`, règle 2/6) | `crm.manage`
- Lignes (mêmes règles que les lignes de deal) : `GET/POST /crm/sales-orders/:soId/line-items`,
  `PATCH|DELETE .../:id` — chaque mutation recalcule `totalAmount` (helper `sumLineItems` partagé,
  même transaction). **Édition des lignes interdite si la commande n'est pas `DRAFT`** (409). | `crm.manage`

### Conversion deal → commande
- `POST /crm/deals/:id/create-sales-order` (dans `DealsController`/`SalesOrdersService`) :
  exige un deal **WON** (cohérent avec `convert`) avec ≥1 ligne ; crée une `SalesOrder` DRAFT en
  **copiant les lignes du deal** (snapshot name/qty/unitPrice/discountPct), lie `companyId`,
  `dealId`, et `customerId` (= `deal.convertedCustomerId` si présent). `totalAmount` recalculé.
  Transaction + audit. | `crm.manage`

## Outil agent (registre, R21)
- `crm_list_sales_orders` (READ, `crm.read`, module CRM) — délègue à `SalesOrdersService.list`.
  Ajout `tool-types.ts` (`crm.listSalesOrders`) + adaptateur.

## Web (Svelte 5 runes, idiomes CRM)
- **`/crm/sales-orders`** : liste (number, company, statut badge, totalAmount, date), filtres
  status/search. Entrée nav « Commandes » (gated `crm.read`).
- **`/crm/sales-orders/[id]`** : en-tête (number, company link, statut, total, owner, notes),
  **éditeur de lignes** (réutilise le patron de `/crm/deals/[id]` : picker catalogue + ligne libre,
  PATCH/DELETE, total recalculé ; **désactivé si statut ≠ DRAFT**), **actions de statut**
  (Confirmer/Exécuter/Facturer/Annuler selon les transitions permises).
- Sur **`/crm/deals/[id]`** : bouton « Créer une commande » (visible si deal WON) →
  `POST /crm/deals/:id/create-sales-order` → redirige vers la commande créée.

## Conformité hard rules
- R1 partout ; R2 statut via `canTransitionSalesOrder` + claim TOCTOU ; R3 enum mirroré ;
  R6 audit sur create/status/line mutations ; R8 numéro via `SequencesService` ;
  R9 FK (`companyId`/`customerId`/`dealId`/`productId`) vérifiées.

## Tests
- **Unit (`@pulsar/shared`)** : `canTransitionSalesOrder` (toutes transitions + terminaux),
  `isSalesOrderOpen`.
- **e2e (`apps/api/test/crm-sales-orders.e2e-spec.ts`)** : create (number SO-), add lignes →
  `totalAmount` recalculé, confirm/fulfill/cancel (transitions valides + refus terminaux 400),
  édition de ligne refusée hors DRAFT (409), conversion deal WON+lignes → commande (lignes copiées,
  total correct, dealId/customerId liés), isolation tenant. Master-data unique, reruns sûrs.

## Hors périmètre v1 (backlog)
- Génération de facture depuis une commande INVOICED (lien Billing — Cycle ultérieur).
- Fulfillment détaillé (lien WMS pick orders / TMS shipments depuis une commande).
- Connecteur Shopify (commande entrante → SalesOrder) — Cycle 4, via `connect/inbound`.
- Édition de quantités fractionnaires avancée / taxes.
