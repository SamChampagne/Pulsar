# Phase 7.3 — Billing sell-side : design

> Validé le 2026-06-11. Troisième chantier de la phase 7. La facturation **client**,
> reportée depuis la phase 6 parce qu'elle bâtissait sur une tarification embryonnaire —
> débloquée par le rating engine v2 (7.1). Boucle le cycle économique achat **et** vente.

## Décisions structurantes

| Décision | Choix | Pourquoi |
| -------- | ----- | -------- |
| Unité facturée + prix | **La commande (TransportOrder), tarifée au rating engine avec les tarifs CLIENT** au moment de la génération du brouillon ; snapshot figé sur la ligne | Évite entièrement l'allocation des coûts d'un load consolidé multi-clients (audit §11 — exige les lignes de commande, non faites) : le prix de vente est indépendant du coût d'achat. Le gel au moment de facturer est le bon moment comptable |
| Modèle | **`CustomerInvoice`/`CustomerInvoiceLine` dédiées** (séquence `CINV-`) | L'`Invoice` buy-side est saturée de champs réconciliation/litige transporteur sans objet côté vente ; deux cycles de vie = deux modèles. Zéro risque de régression sur le module livré |
| Cycle de vie | **DRAFT → APPROVED → SENT → PAID** + **suppression d'un brouillon DRAFT** (libère les commandes) | Le `sentAt` trace l'envoi (relances futures). La sortie de brouillon est obligatoire : sans elle, la contrainte anti-double-facturation rendrait infacturable à jamais toute commande prise dans un brouillon raté — premier cas réel qu'un utilisateur rencontrera |
| Wording | Le courriel et l'UI parlent de **« relevé de facturation » (billing statement)**, pas de « facture » | Tant que les taxes (TPS/TVQ/TVA) sont hors périmètre, émettre un document intitulé « facture » sans taxes expose les clients à des risques de conformité. Les taxes = premier ajout post-7.3 (note ROADMAP) |
| Devises | **Regroupement par devise : la génération produit une facture par devise rencontrée** | Les tarifs client gagnants peuvent différer en devise selon les commandes (le rating 7.1 ne convertit volontairement pas). Une facture porte une devise unique ; le regroupement est l'option la moins surprenante |
| Jamais 0, rien de silencieux | Une commande sans tarif client applicable est **exclue du brouillon et listée avec son motif** | Corrige le défaut du design sell-side abandonné en phase 6 (« montant proposé, fallback 0 éditable ») : on ne facture jamais 0 par accident |

## 1. Modèle de données

### `CustomerInvoice` (table `customer_invoices`)

`{ id, tenantId, invoiceNumber, customerId, status, currency, totalAmount Decimal(12,2),
approvedAt?, sentAt?, paidAt?, createdAt, updatedAt }`
- `invoiceNumber` : séquence **`CINV-`** via `SequencesService.nextNumber()` (règle 8).
- `@@unique([tenantId, invoiceNumber])`, `@@index([tenantId, status])`,
  `@@index([tenantId, customerId])`. FKs tenant/customer.
- `status` : enum `CustomerInvoiceStatus` (`DRAFT | APPROVED | SENT | PAID`) — partagé +
  miroir Prisma.

### `CustomerInvoiceLine` (table `customer_invoice_lines`)

`{ id, customerInvoiceId, transportOrderId @unique, description, amount Decimal(12,2),
priceDetail Json }`
- **`transportOrderId @unique` = anti-double-facturation** (même mécanique éprouvée que
  `InvoiceLine.loadId` buy-side).
- `priceDetail` = **snapshot sell-side auto-portant** : tarif client tel qu'utilisé
  (id, nom, type, montants, tranches, carburant résolu, validité, `validAtReference`),
  intrants (poids/volume/palettes de la commande, date de référence), lignes de calcul,
  total — même structure `version: 1` que `Load.costDetail`.
- Cascade sur la facture (la suppression d'un brouillon emporte ses lignes — c'est le
  mécanisme de libération), `onDelete: Restrict` vers la commande.

### Invariants (mêmes phrases que le buy-side, côté vente)

1. **Une ligne d'une facture émise (APPROVED et au-delà) ne se recalcule jamais** — le
   snapshot fait foi. Modifier un tarif client après émission ne change rien (testé e2e).
2. **La seule sortie d'un brouillon est sa suppression** (`DELETE`, statut DRAFT
   uniquement, auditée) — elle supprime les lignes en cascade et **libère les commandes**
   pour une regénération. Les factures APPROVED+ sont immuables (avoirs = hors périmètre).

### Machine à états

`packages/shared/src/workflows/customer-invoice.workflow.ts` :
`canTransitionCustomerInvoice` — DRAFT→APPROVED, APPROVED→SENT, SENT→PAID (et rien
d'autre ; la suppression du DRAFT n'est pas une transition, c'est un DELETE). Testée
vitest comme les autres machines.

## 2. Tarification sell-side (réutilisation du rating 7.1)

- **Facturable** : commande `COMPLETED` ou `CLOSED` du client, sans ligne de facture.
- `RatingService.rateOrder(tenantId, orderId)` (nouvelle méthode, même service) :
  - lane : origine→destination de la commande (clés candidates `candidateEndpointKeys`
    existantes) ;
  - métriques : `totalWeightKg`, `totalVolumeM3`, `palletCount` de la commande ;
  - candidats : `Rate.status = ACTIVE` **et `customerId = order.customerId`** (les
    tarifs transporteur et attrape-tout sans customerId ne participent jamais au
    sell-side) + lane match ou attrape-tout-client (`laneId null`), validité à la date
    de référence ;
  - **date de référence : la livraison réelle** (max `actualDeliveryAt` des shipments ;
    fallback : date du jour) — gouverne carburant ET validité, comme en 7.1 ;
  - pas d'accessorials sell-side en v1 (tranches/minCharge/carburant datés des tarifs
    client s'appliquent normalement) ;
  - sélection : le total le moins cher (ordre déterministe de `compareRateOptions`) ;
  - sortie : `{ breakdown, currency, snapshot }` ou `null` (aucun tarif applicable).
- **Génération du brouillon** (`POST /billing/customer-invoices` body `{ customerId }`) :
  évalue toutes les commandes facturables du client ; **regroupe par devise du tarif
  gagnant → une facture par devise** ; les non-tarifables sont retournées dans la
  réponse avec le motif (`NO_APPLICABLE_RATE`) et n'apparaissent sur aucune facture.
  Réponse : `{ invoices: [...], unratable: [{ orderId, orderNumber, reason }] }`.
- **Prévisualisation** (`GET /billing/customer-invoices/billable?customerId=`) : même
  évaluation sans rien persister — tarifables avec montant/devise, non-tarifables avec
  motif.

## 3. API (module billing)

| Endpoint | Permission | Notes |
| -------- | ---------- | ----- |
| `GET /billing/customer-invoices` | `billing.customer-invoices.read` | Paginé, filtre `status`, `customerId` |
| `GET /billing/customer-invoices/billable?customerId=` | `.read` | Prévisualisation |
| `POST /billing/customer-invoices` | `.manage` | Génération par client, regroupée par devise |
| `GET /billing/customer-invoices/:id` | `.read` | Détail avec lignes + snapshots |
| `DELETE /billing/customer-invoices/:id` | `.manage` | **DRAFT uniquement** (400 sinon), cascade lignes, audité (la libération des commandes est l'effet recherché) |
| `POST /billing/customer-invoices/:id/approve` | `.manage` | DRAFT→APPROVED, garde `updateMany` conditionnel (pattern anti-TOCTOU 7.4) |
| `POST /billing/customer-invoices/:id/send` | `.send` | APPROVED→SENT ; **courriel « relevé de facturation »** HTML (récapitulatif lignes + total + devise) au contact courriel du client via `EmailService` ; `sentAt` horodaté ; échec d'envoi = la transition n'a pas lieu |
| `POST /billing/customer-invoices/:id/pay` | `.pay` | SENT→PAID, `paidAt` |

Permissions au catalogue : `billing.customer-invoices.read / .manage / .send / .pay`.
Audit : `AuditLogsService.log` explicite avec before/after sur chaque transition + le
DELETE (règle 14). `@RequireModule(MODULE_KEYS.BILLING)` partout. Toutes transitions via
`canTransitionCustomerInvoice` (règle 2).

## 4. Web

Page Invoices actuelle → **deux onglets** : « Carrier invoices » (existant, inchangé) et
« Customer invoices » : sélection d'un client → prévisualisation (tarifables avec
montants + non-tarifables avec motifs visibles) → bouton Générer → liste des relevés
(statuts) → détail (lignes avec snapshot déplié — réutiliser l'idiome d'affichage du
snapshot de coût du load detail) → actions Approve / Send / Mark paid / Delete draft.
Wording UI : **« Billing statement »** / « relevé », pas « invoice/facture », tant que
les taxes n'existent pas.

## 5. Tests & migration

- 1 migration : 2 tables + enum (+ `CINV` dans les séquences au premier usage — la
  mécanique `SequencesService` existante crée la séquence à la volée).
- Vitest : machine à états customer-invoice.
- Jest : règle de regroupement par devise (fonction pure extraite), exclusion
  non-tarifable.
- E2E (suite 7.3) : tarif client + commande livrée → billable preview → génération
  (snapshot conforme, devise correcte) → approve → send (`sentAt`, courriel loggé) →
  pay ; anti-double-facturation (2ᵉ génération = vide) ; commande sans tarif client →
  `unratable` avec motif ; **modification du tarif client après émission → la ligne ne
  bouge pas** (invariant) ; **DELETE du brouillon → la commande redevient facturable** ;
  deux tarifs client en devises différentes → deux factures.

## 6. Hors périmètre (explicite)

Taxes (TPS/TVQ/TVA) — **premier ajout post-7.3 si des clients facturent réellement**
(note ROADMAP) ; avoirs/notes de crédit et annulation post-APPROVED ; PDF ; relances ;
marge par facture (exige l'allocation des coûts d'un load partagé — chantier analytics) ;
conversion de devises ; accessorials sell-side.
