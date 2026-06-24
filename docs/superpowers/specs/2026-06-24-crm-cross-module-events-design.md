# CRM ↔ modules — Événements de jalon + lien finance (Cycle 6)

**Date:** 2026-06-24
**Statut:** auto-validé (autonomie déléguée — `pulsar-autonomie-execution`)
**Modules:** CRM + Billing (via réactions), core/automation, core/operating
**Branche:** `crm-email-threads`

## Objectif

Relier le CRM au reste de la plateforme : émettre des **événements de domaine** sur les jalons CRM
(deal gagné, commande confirmée/facturée) pour qu'ils soient visibles par le **Control Tower de
flux** (arc A), l'**automatisation** (arc B) et les **agents/IA** ; et brancher un **lien finance**
concret : une commande de vente passée à `INVOICED` crée un **relevé client brouillon** (Billing)
via le mécanisme de réactions existant.

## Décisions de design (auto-arrêtées)

1. **Émission d'événements (best-effort, règle 27/37/38)** via `DomainEventsService.emit` :
   - `crm.deal.won` — quand un deal avance à `WON` (dans `DealsService.advance`).
   - `crm.sales_order.confirmed` / `crm.sales_order.invoiced` — dans `SalesOrdersService.transition`.
   Payloads minimaux : `{ dealId, companyId }` / `{ salesOrderId, companyId, customerId }`.
   `moduleOfEventType('crm.*')` → `'CRM'` est **déjà** mappé → ces événements apparaissent
   automatiquement dans `GET /analytics/flow/timeline` (aucune modif flow nécessaire ; vérifier).
2. **Lien finance = une réaction whitelistée** (règle 38) `draft_invoice_from_sales_order` :
   - Ajoutée à `REACTION_CATALOG` (`@pulsar/shared`, pure data) : module `billing`,
     `requiredModules: ['billing']`, `argKeys: ['salesOrderId']`.
   - Handler dans `ReactionExecutorService` (mirroir de `draftCustomerInvoice`) : résout
     `CustomerInvoicesService` via `ModuleRef.get(..., { strict:false })` + lazy `require()` (PAS
     d'import statique — anti-cycle, règle 38). Idempotent sur `(tenantId, eventId, ruleId)` via
     `ReactionExecution` (déjà géré par l'exécuteur).
3. **Nouvelle méthode Billing** `CustomerInvoicesService.createDraftFromSalesOrder(tenantId, userId,
   salesOrderId)` : crée UN relevé client brouillon à partir des **lignes de la commande** (name /
   quantity / unitPrice / discountPct → lignes de relevé), lié au `customerId` de la commande (si
   absent, no-op + log — la commande doit être convertie d'un deal avec customer, ou avoir un
   customerId). N° via `SequencesService` (règle 8, clé invoice existante). Idempotent : si un
   relevé brouillon référence déjà cette commande (`relatedType='sales-order'`/`relatedId`), skip.
   Devise = celle de la commande (repli `defaultCurrency`, règle 36). Audit (règle 6).
4. **Règle built-in seedée** : `crm.sales_order.invoiced` → `RUN_ACTION draft_invoice_from_sales_order`
   `args: { salesOrderId: '{salesOrderId}' }` (mirroir de la règle `load.completed →
   draft_customer_invoice` du seed). Anti-boucle single-hop déjà géré par `processPending` (règle 38).
5. **Pour l'IA** : les événements émis sont désormais dans le système — visibles par le Control Tower
   de flux, l'automatisation, et consommables par les agents/Workbench. Les **policies
   événement→tâche agent** (règle 27) pour ces événements CRM sont **hors périmètre v1** (backlog) ;
   l'étape habilitante (émission) est livrée ici.

## Conformité hard rules

- **Règle 16/36** : `createDraftFromSalesOrder` ne recalcule jamais un coût figé ; il lit les lignes
  de la commande (snapshots) et `defaultCurrency` en repli. Pas de double-billing (idempotence).
- **Règle 38** : la réaction passe par `REACTION_CATALOG` + `ReactionExecutorService` (ModuleRef +
  lazy require, jamais d'import statique de `BillingModule`/`CrmModule`) ; idempotente sur
  `(tenantId, eventId, ruleId)` ; anti-boucle single-hop ; effets gouvernés best-effort.
- **Règle 27/37** : événements via `DomainEventsService.emit` (best-effort, jamais bloquant) ;
  `moduleOfEventType` reste la seule source type→module (déjà `crm`→CRM).
- **Règle 8** : numéro de relevé via `SequencesService`. **Règle 1** : tenant-scope partout.
  **Règle 2** : l'émission `crm.sales_order.*` se fait dans `transition` APRÈS le claim conditionnel
  réussi (statut réellement changé).

## Architecture / fichiers

- `apps/api/src/modules/crm/deals.service.ts` : injecter `DomainEventsService` (OperatingModule déjà
  importé par CrmModule) ; émettre `crm.deal.won` dans `advance` quand `toStage === WON` (après le
  claim réussi, best-effort).
- `apps/api/src/modules/crm/sales-orders.service.ts` : injecter `DomainEventsService` ; émettre
  `crm.sales_order.confirmed`/`crm.sales_order.invoiced` dans `transition` après le claim réussi
  selon la cible.
- `packages/shared/src/automation/reactions.ts` : ajouter `draft_invoice_from_sales_order` au
  `REACTION_CATALOG`.
- `apps/api/src/core/automation/reaction-executor.service.ts` : `case 'draft_invoice_from_sales_order'`
  + handler `draftInvoiceFromSalesOrder(tenantId, { salesOrderId })`.
- `apps/api/src/modules/billing/customer-invoices.service.ts` : `createDraftFromSalesOrder(...)`.
- `packages/database/prisma/seed.ts` : règle built-in `crm.sales_order.invoiced → draft_invoice_from_sales_order`.

## Tests

- **Unit (`@pulsar/shared`)** : `REACTION_CATALOG` contient `draft_invoice_from_sales_order` avec
  `requiredModules:['billing']`, `argKeys:['salesOrderId']` (étend le spec catalog existant) ;
  `moduleOfEventType('crm.sales_order.invoiced')==='CRM'`.
- **e2e (`apps/api/test/crm-cross-module.e2e-spec.ts`)** : 
  1. deal WON via advance → un `DomainEvent` `crm.deal.won` existe (tenant acme).
  2. SalesOrder → confirm → fulfill → **invoiced** ; après `processPending` du worker de
     domain-events (ou en appelant le tick), un `CustomerInvoice` brouillon lié à la commande existe
     (via la réaction) ET un `ReactionExecution` est enregistré ; ré-exécuter `processPending` ne
     crée pas de second relevé (idempotence).
  3. `createDraftFromSalesOrder` sans customerId → no-op (pas de relevé, pas d'erreur).
  4. Isolation tenant.
  (Mirroir du e2e des réactions existant si présent ; sinon créer master-data unique.)

## Hors périmètre v1 (backlog)
- Policies événement CRM → tâche agent (règle 27) pour réveiller un agent sur un deal gagné / une
  commande facturée.
- Réaction deal.won → créer automatiquement une commande de vente (laisser manuel v1).
- Envoi automatique du relevé (reste gouverné / manuel).
