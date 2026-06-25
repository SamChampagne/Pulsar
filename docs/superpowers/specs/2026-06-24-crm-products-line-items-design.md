# CRM Produits — Catalogue + lignes de produit sur les deals (Cycle 2)

**Date:** 2026-06-24
**Statut:** auto-validé (autonomie déléguée — cf. mémoire `pulsar-autonomie-execution`)
**Module:** CRM (`MODULE_KEYS.CRM`)
**Branche:** `crm-email-threads` (travail CRM groupé)

## Objectif

Donner au CRM un **catalogue de produits** et des **lignes de produit sur les deals** : le montant
d'un deal devient *calculé* (somme des lignes) au lieu d'un champ libre, ce qui ouvre la voie aux
devis, puis aux commandes de vente et au lien Billing. Socle de la trajectoire commerce
(cf. `pulsar-vision-crm-commerce`).

Inclut une **page de détail de deal** (`/crm/deals/[id]`) — elle manquait (le clic sur une carte
kanban tombait sur la liste), et c'est l'endroit naturel pour éditer les lignes.

## Décisions de design (auto-arrêtées)

1. **Deux entités** : `CrmProduct` (catalogue tenant) et `CrmDealLineItem` (ligne sur un deal,
   snapshot du nom + prix au moment de l'ajout, productId optionnel pour les lignes libres).
2. **Montant du deal dérivé** : toute mutation de ligne (create/update/delete) recalcule
   `deal.amount = Σ (quantity × unitPrice × (1 − discountPct/100))` **dans la même transaction**
   (helper pur `@pulsar/shared`). Quand il reste des lignes, `amount` est piloté par les lignes
   (comme HubSpot/Attio). Sans lignes, l'édition manuelle de `amount` via `PATCH /crm/deals/:id`
   reste possible (inchangé). Suppression de la dernière ligne → `amount = 0`.
3. **Permissions** : réutilise `crm.read`/`crm.manage` (les produits font partie du CRM). Pas de
   nouvelle clé de permission.
4. **Devise** : la ligne hérite de la devise du deal ; le catalogue porte sa propre devise
   (repli quand on crée une ligne libre). Pas de conversion multi-devise (hors périmètre).
5. **Agent** : un outil READ `crm_list_products` (le coach peut référencer le catalogue pour
   chiffrer). Les outils mutating de lignes sont **hors périmètre v1** (le coach propose en texte ;
   l'humain édite). Garde le scope serré.

## Modèle de données (Prisma + migration additive)

```prisma
model CrmProduct {
  id          String   @id @default(cuid())
  tenantId    String
  name        String
  sku         String?
  description String?
  unitPrice   Decimal  @default(0)
  currency    String   @default("CAD")
  active      Boolean  @default(true)
  customData  Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  lineItems   CrmDealLineItem[]
  @@index([tenantId, active])
  @@map("crm_products")
}

model CrmDealLineItem {
  id          String   @id @default(cuid())
  tenantId    String
  dealId      String
  productId   String?
  name        String          // snapshot (du produit ou saisi libre)
  quantity    Decimal  @default(1)
  unitPrice   Decimal  @default(0)   // snapshot
  discountPct Decimal  @default(0)   // 0..100
  currency    String   @default("CAD")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deal        CrmDeal     @relation(fields: [dealId], references: [id], onDelete: Cascade)
  product     CrmProduct? @relation(fields: [productId], references: [id])
  @@index([tenantId, dealId])
  @@map("crm_deal_line_items")
}
```
`CrmDeal` gagne la relation inverse `lineItems CrmDealLineItem[]`. `Tenant` gagne
`crmProducts CrmProduct[]` (back-relations explicites comme le reste du schéma). Migration
additive (nouvelles tables + relations nullable). Reseed : 3 produits démo + 1-2 lignes sur un
deal existant (montant recalculé).

## Helpers purs (`packages/shared/src/crm/line-items.ts`)

- `computeLineTotal(line: { quantity, unitPrice, discountPct }): number` — arrondi à 2 décimales.
- `sumLineItems(lines): number` — Σ des totaux, arrondi 2 décimales.
Testés unitairement (quantité, remise, arrondi, liste vide → 0).

## API (module CRM, `@RequireModule(CRM)`, tenant-scopé R1, FK vérifiées R9, audit R6)

### Catalogue — `apps/api/src/modules/crm/products.{controller,service}.ts`
- `GET /crm/products` — `Paginated`, filtres `active`, `search` (name/sku) | `crm.read`
- `GET /crm/products/:id` | `crm.read`
- `POST /crm/products` (name requis ; unitPrice/currency/sku/description/active ; `customData` validé via `CustomFieldsService` si une définition `crm/product` existe — règle 35 généralisée) | `crm.manage`
- `PATCH /crm/products/:id` (PartialType) | `crm.manage`
- `DELETE /crm/products/:id` — refus 409 si des lignes le référencent (sinon supprime) | `crm.manage`

### Lignes — `apps/api/src/modules/crm/line-items.{controller,service}.ts`
- `GET /crm/deals/:dealId/line-items` — lignes du deal (chrono) | `crm.read`
- `POST /crm/deals/:dealId/line-items` — body `{ productId?, name?, quantity?, unitPrice?, discountPct? }`.
  Si `productId` : vérifie ownership (R9), snapshot `name`/`unitPrice`/`currency` depuis le produit
  (override permis par le body). Sinon `name` requis. **Recalcule `deal.amount`** (transaction). | `crm.manage`
- `PATCH /crm/deals/:dealId/line-items/:id` — maj quantity/unitPrice/discountPct/name ; **recalcul**. | `crm.manage`
- `DELETE /crm/deals/:dealId/line-items/:id` — supprime ; **recalcul** (0 si plus de lignes). | `crm.manage`
- Le recalcul lit toutes les lignes du deal et écrit `amount` via `updateMany({ id, tenantId })`
  (jamais de `update({ stage })` — sans rapport avec R2). `LineItemsService.recomputeDealAmount(tx, tenantId, dealId)` factorisé.

## Outil agent (registre, R21)

- `crm_list_products` (READ, `crm.read`, module CRM) : liste le catalogue (active) → délègue à
  `ProductsService.list`. Ajout dans `tool-types.ts` (`crm.listProducts`) + adaptateur `agents.module.ts`.

## Web (Svelte 5 runes, idiomes CRM existants)

- **`/crm/products`** : page catalogue (liste + filtres active/search, création/édition via panneau
  ou modal, suppression). Entrée nav « Produits » (gated `crm.read`).
- **`/crm/deals/[id]`** (nouvelle page détail deal) : en-tête (titre, company, stage, montant
  **calculé**, owner), **éditeur de lignes** (ajouter depuis le catalogue ou ligne libre, éditer
  quantité/prix/remise, supprimer ; total mis à jour), liens vers le coach (`/crm/coach?dealId=`)
  et la fiche company. Le clic sur une carte kanban et la liste deals pointent désormais ici.

## Conformité hard rules

- R1 tenant isolation partout. R9 FK (`productId`, `dealId`). R6 audit sur mutations
  produits + lignes. R3 (aucun nouvel enum). R35 généralisé : `customData` produit validé à l'intake.
- Le recalcul de `amount` est déterministe côté serveur ; `OverviewService`/`pipeline` lisent
  `amount` inchangé (aucune divergence introduite).

## Tests

- **Unit (`@pulsar/shared`)** : `computeLineTotal`/`sumLineItems` (quantité, remise, arrondi, vide).
- **e2e (`apps/api/test/crm-products.e2e-spec.ts`)** : CRUD produit ; ajout de 2 lignes sur un deal
  → `deal.amount` = somme ; PATCH quantité → recalcul ; DELETE ligne → recalcul ; refus DELETE
  produit référencé (409) ; isolation tenant. Crée sa master-data (codes uniques, reruns sûrs).

## Hors périmètre v1 (backlog)

- Outils agent mutating de lignes (le coach chiffre lui-même).
- Devis PDF / envoi de devis (Cycle ultérieur, s'appuiera sur les lignes).
- Commandes de vente (Cycle 3) ; lien Billing (facture depuis lignes).
- Conversion de devise multi-monnaie.
